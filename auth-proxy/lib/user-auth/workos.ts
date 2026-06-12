/**
 * WorkOS user-auth provider.
 *
 * Wraps the WorkOS HTTP boundary for the auth-proxy's `/api/auth/callback`,
 * `/api/auth/refresh`, and `/api/auth/logout` endpoints. All WorkOS calls go
 * through an injected `fetch`; the WorkOS `refresh_token` is held server-side
 * in the session-store and never leaves the server (OQ1 (b)).
 */

import { randomUUID } from "node:crypto";

import { mintUserToken } from "../user-token.ts";
import type { SessionLookup, SessionPayload } from "../session-store.ts";

export interface WorkOsConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionTtlSeconds: number;
  /**
   * When true, `logout` POSTs the WorkOS refresh_token to the
   * sessions-revoke endpoint before deleting the local session-store
   * entry. Off by default — local deletion alone is what the FE waits
   * on, and the WorkOS revoke is a best-effort defence in depth.
   */
  revokeOnLogout?: boolean;
}

export interface SessionStorePort {
  set(sid: string, payload: SessionPayload): void;
  get(sid: string): SessionPayload | null;
  getStatus(sid: string): SessionLookup;
  delete(sid: string): boolean;
}

export interface UserAuthProvider {
  handleCallback(input: {
    code: string;
    state: string;
  }): Promise<{ accessToken: string; sid: string; expiresIn: number }>;
  refresh(
    sid: string,
  ): Promise<{ accessToken: string; expiresIn: number }>;
  logout(sid: string): Promise<void>;
}

interface WorkOsAuthenticateResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; first_name?: string };
  organization_id?: string;
}

export class WorkOsUserAuthProvider implements UserAuthProvider {
  private readonly fetchPort: typeof globalThis.fetch;
  private readonly sessionStore: SessionStorePort;
  private readonly config: WorkOsConfig;

  constructor(deps: {
    fetch?: typeof globalThis.fetch;
    sessionStore: SessionStorePort;
    config: WorkOsConfig;
  }) {
    this.fetchPort =
      deps.fetch ?? ((...args) => globalThis.fetch(...args));
    this.sessionStore = deps.sessionStore;
    this.config = deps.config;
  }

  async handleCallback(input: {
    code: string;
    state: string;
  }): Promise<{ accessToken: string; sid: string; expiresIn: number }> {
    const workos = await this.callAuthenticate({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });

    const sid = randomUUID();
    const claims = {
      sub: workos.user.id,
      email: workos.user.email,
      name: workos.user.first_name ?? "",
      org_id: workos.organization_id ?? "",
    };
    const { token, expiresIn } = await mintUserToken({ ...claims, sid });
    this.sessionStore.set(sid, {
      workos_refresh_token: workos.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user_claims: claims,
      // The WorkOS access token's `sid` claim IS the WorkOS session id — captured
      // here so logout can build the WorkOS end-session URL (the auth-proxy mints
      // its OWN `sid` above for the local session store; they are distinct).
      workos_session_id: decodeWorkosSessionId(workos.access_token),
    });
    return { accessToken: token, sid, expiresIn };
  }

  async refresh(
    sid: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const session = this.sessionStore.get(sid);
    if (!session) {
      throw new Error("invalid_session");
    }

    const rotated = await this.callAuthenticate({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: session.workos_refresh_token,
    });

    const { token, expiresIn } = await mintUserToken({
      ...session.user_claims,
      sid,
    });
    this.sessionStore.set(sid, {
      workos_refresh_token: rotated.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user_claims: session.user_claims,
      // Preserve the WorkOS session id across refresh. The keep-alive beat
      // refreshes every ~5 min while the user is active; dropping it here would
      // leave logout unable to build the WorkOS end-session URL, so the next
      // login would silently re-authenticate against a still-live SSO session.
      workos_session_id: session.workos_session_id,
    });
    return { accessToken: token, expiresIn };
  }

  async logout(sid: string): Promise<void> {
    const session = this.sessionStore.get(sid);
    if (this.config.revokeOnLogout && session) {
      await this.fetchPort(
        `${this.config.baseUrl}/user_management/sessions/revoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: session.workos_refresh_token,
          }),
        },
      );
    }
    this.sessionStore.delete(sid);
  }

  /**
   * Create a WorkOS organization (CDO-S5, ADR-048 §1). Authorizes with the
   * WorkOS API key (`config.clientSecret` = WORKOS_API_KEY) as a Bearer.
   * 5s timeout per call (R5); NO auto-retry — org create is NOT idempotent,
   * so the WORKFLOW owns the (non-)retry policy, not this boundary.
   */
  async createOrganization(name: string): Promise<{ id: string }> {
    const response = await this.callWorkos("POST", "/organizations", { name });
    const json = (await response.json()) as { id?: unknown };
    if (typeof json.id !== "string" || json.id.length === 0) {
      throw new Error("service_error");
    }
    return { id: json.id };
  }

  /**
   * Create a WorkOS organization-membership binding the verified user (their
   * token `sub` IS the WorkOS user id) to the freshly-created org. Idempotent —
   * the workflow may retry once on a transient failure.
   */
  async createOrganizationMembership(
    userId: string,
    orgId: string,
  ): Promise<void> {
    await this.callWorkos("POST", "/user_management/organization_memberships", {
      user_id: userId,
      organization_id: orgId,
    });
  }

  /**
   * Delete a WorkOS organization — the compensation leg for a backend persist
   * failure after a successful WorkOS provision (ADR-048 §3, best-effort). The
   * workflow may retry once.
   */
  async deleteOrganization(orgId: string): Promise<void> {
    await this.callWorkos("DELETE", `/organizations/${orgId}`);
  }

  /**
   * Shared WorkOS REST wrapper for the org-provisioning ops. Mirrors
   * `callAuthenticate`'s failure mapping (throw → service_error, non-ok →
   * service_error) but targets the API-key-authorized organizations surface
   * with a 5s AbortSignal per call.
   */
  private async callWorkos(
    method: "POST" | "DELETE",
    path: string,
    body?: Record<string, string>,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchPort(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.clientSecret}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error("service_error");
    }
    if (!response.ok) {
      throw new Error("service_error");
    }
    return response;
  }

  private async callAuthenticate(
    body: Record<string, string>,
  ): Promise<WorkOsAuthenticateResponse> {
    let response: Response;
    try {
      response = await this.fetchPort(
        `${this.config.baseUrl}/user_management/authenticate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new Error("service_error");
    }
    if (response.status === 401) {
      throw new Error("unauthorized");
    }
    if (!response.ok) {
      throw new Error("service_error");
    }
    return (await response.json()) as WorkOsAuthenticateResponse;
  }
}

/**
 * Best-effort decode of a WorkOS access token's `sid` (session id) claim — the
 * value needed to build the WorkOS end-session URL on logout. The token is NOT
 * verified here (it is WorkOS-issued and was just exchanged); we only read its
 * payload. Returns undefined for a malformed token or an absent `sid`.
 */
export function decodeWorkosSessionId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return undefined;
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sid?: unknown };
    return typeof claims.sid === "string" ? claims.sid : undefined;
  } catch {
    return undefined;
  }
}
