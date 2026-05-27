/**
 * Dev-mode user-auth provider.
 *
 * Mints user tokens locally for `AUTH_MODE=dev` without any WorkOS round-trip
 * — the whole reason this provider exists is to keep dev cycles fast and off
 * WorkOS's audit log. Implements the same `UserAuthProvider` contract as
 * `WorkOsUserAuthProvider` so `app.ts` can dispatch by mode through a single
 * factory.
 */

import { randomUUID } from "node:crypto";

import type { SessionUserClaims } from "../session-store.ts";
import { mintUserToken } from "../user-token.ts";
import type { SessionStorePort, UserAuthProvider } from "./workos.ts";

export interface DevConfig {
  authMode: string;
  userIdentity: SessionUserClaims;
}

const DEV_AUTH_CODE = "dev-auth-code";
const DEV_REFRESH_INITIAL = "dev-refresh-token-001";

function mintDevRefreshToken(): string {
  return `dev-refresh-token-${randomUUID()}`;
}

/**
 * Resolve the dev identity from environment, falling back to the
 * CLAUDE.md fixtures (`dev-user-001` / `dev-org-001`). Read at factory
 * call time so each request observes the live env.
 */
function resolveDevIdentity(): SessionUserClaims {
  return {
    sub: process.env.DEV_USER_ID || "dev-user-001",
    email: process.env.DEV_USER_EMAIL || "dev@localhost",
    name: process.env.DEV_USER_NAME || "Dev User",
    org_id: process.env.DEV_ORG_ID || "dev-org-001",
  };
}

/**
 * Build a `DevUserAuthProvider` for the current request. Reads
 * `AUTH_MODE` and the `DEV_USER_*` / `DEV_ORG_ID` identity env vars at
 * call time so dev-mode overrides take effect without a server restart.
 */
export function createDevProvider(deps: {
  sessionStore: SessionStorePort;
}): DevUserAuthProvider {
  return new DevUserAuthProvider({
    sessionStore: deps.sessionStore,
    config: {
      authMode: process.env.AUTH_MODE || "dev",
      userIdentity: resolveDevIdentity(),
    },
  });
}

export class DevUserAuthProvider implements UserAuthProvider {
  private readonly sessionStore: SessionStorePort;
  private readonly config: DevConfig;

  constructor(deps: { sessionStore: SessionStorePort; config: DevConfig }) {
    this.sessionStore = deps.sessionStore;
    this.config = deps.config;
  }

  async handleCallback(input: {
    code: string;
    state: string;
  }): Promise<{ accessToken: string; sid: string; expiresIn: number }> {
    this.requireDevMode();
    if (input.code !== DEV_AUTH_CODE) {
      throw new Error("invalid_code");
    }
    const sid = randomUUID();
    const { token, expiresIn } = await mintUserToken({
      ...this.config.userIdentity,
      sid,
    });
    this.sessionStore.set(sid, {
      workos_refresh_token: DEV_REFRESH_INITIAL,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user_claims: this.config.userIdentity,
    });
    return { accessToken: token, sid, expiresIn };
  }

  async refresh(
    sid: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    this.requireDevMode();
    const session = this.sessionStore.get(sid);
    if (!session) {
      throw new Error("invalid_session");
    }
    const { token, expiresIn } = await mintUserToken({
      ...session.user_claims,
      sid,
    });
    this.sessionStore.set(sid, {
      workos_refresh_token: mintDevRefreshToken(),
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      user_claims: session.user_claims,
    });
    return { accessToken: token, expiresIn };
  }

  async logout(sid: string): Promise<void> {
    this.sessionStore.delete(sid);
  }

  private requireDevMode(): void {
    if (this.config.authMode !== "dev") {
      throw new Error("dev_provider_inactive");
    }
  }
}
