// UserFlowHarness — TS acceptance harness for J-001 (login-and-org-setup).
//
// First-class deliverable of US-004. The harness is itself a test target:
// the @us-004 scenarios in `slice-2-harness-drives-transitions.feature`
// drive THROUGH this harness to verify its public surface matches the
// contract Maya-shaped + Rajesh-shaped tests need.
//
// All harness methods route through auth-proxy (CM-A: driving port only).
// No method imports from flow-state/lib/**.

import { request } from "undici";

import type {
  ActiveScope,
  FlowProjection,
  UnderlyingCauseTag,
} from "./types.ts";

export interface PersonaConfig {
  id: string;
  email: string;
  display_name: string;
}

export interface HarnessConfig {
  authProxyUrl: string; // e.g. http://localhost:1042
  fakeWorkOSUrl: string; // e.g. http://localhost:14299
  defaultMachine?: string; // "login-and-org-setup"
}

export class UserFlowHarness {
  private correlationId: string | null = null;
  private flowId: string | null = null;
  private jwt: string | null = null;
  private lastProjection: FlowProjection | null = null;

  constructor(
    private readonly config: HarnessConfig,
    private readonly persona: PersonaConfig,
  ) {}

  async begin_auth(_personaName: string): Promise<FlowProjection> {
    const machine = this.config.defaultMachine ?? "login-and-org-setup";
    const res = await request(
      `${this.config.authProxyUrl}/flow-state/flow/${machine}/begin`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persona_email: this.persona.email,
          persona_display_name: this.persona.display_name,
        }),
      },
    );
    const body = (await res.body.json()) as unknown;
    if (res.statusCode !== 200) {
      throw new Error(
        `begin_auth expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    const projection = body as FlowProjection;
    this.correlationId = projection.correlation_id;
    this.flowId = projection.flow_id;
    this.lastProjection = projection;
    return projection;
  }

  async submit_org(name: string): Promise<FlowProjection> {
    return this.send_event("org_form_submitted", { org_name: name });
  }

  async force_transient_failure(tag: UnderlyingCauseTag): Promise<FlowProjection> {
    return this.send_event("__harness_force_failure__", { tag });
  }

  async expire_token(): Promise<FlowProjection> {
    return this.send_event("__harness_expire_token__", {});
  }

  async assert_state(expected: string): Promise<void> {
    const projection = await this.get_projection();
    if (projection.state !== expected) {
      throw new Error(
        `assert_state failed: expected "${expected}", actual "${projection.state}"`,
      );
    }
  }

  async assert_scope(expected: Partial<ActiveScope>): Promise<void> {
    const projection = await this.get_projection();
    const actual = projection.active_scope;
    const diffs: string[] = [];
    for (const key of Object.keys(expected) as (keyof ActiveScope)[]) {
      if (actual[key] !== expected[key]) {
        diffs.push(
          `${String(key).padEnd(14)} expected: ${String(expected[key]).padEnd(28)} actual: ${String(actual[key])}`,
        );
      }
    }
    if (diffs.length > 0) {
      throw new Error(`assert_scope failed:\n${diffs.join("\n")}`);
    }
  }

  async assert_jwt_carries_org_claim(): Promise<void> {
    if (!this.jwt) {
      throw new Error(
        "assert_jwt_carries_org_claim failed: harness has no JWT (have you reached ready?)",
      );
    }
    const projection = await this.get_projection();
    const claim = decodeJwtOrgIdUnchecked(this.jwt);
    const ctxOrg = (projection.context as { org?: { id?: string } }).org?.id;
    if (!claim || claim !== ctxOrg) {
      throw new Error(
        `assert_jwt_carries_org_claim failed: jwt.org_id=${claim} state.org.id=${ctxOrg}`,
      );
    }
  }

  async get_projection(): Promise<FlowProjection> {
    if (!this.flowId) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const machine = this.config.defaultMachine ?? "login-and-org-setup";
    const res = await request(
      `${this.config.authProxyUrl}/flow-state/flow/${machine}/projection?flow_id=${encodeURIComponent(this.flowId)}`,
      { method: "GET" },
    );
    const body = (await res.body.json()) as unknown;
    if (res.statusCode !== 200) {
      throw new Error(
        `get_projection expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    this.lastProjection = body as FlowProjection;
    return this.lastProjection;
  }

  get_last_correlation_id(): string | null {
    return this.correlationId;
  }

  private async send_event(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<FlowProjection> {
    if (!this.flowId) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const machine = this.config.defaultMachine ?? "login-and-org-setup";
    const res = await request(
      `${this.config.authProxyUrl}/flow-state/flow/${machine}/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: this.flowId,
          type,
          payload,
          correlation_id: this.correlationId,
        }),
      },
    );
    const body = (await res.body.json()) as unknown;
    if (res.statusCode !== 200) {
      throw new Error(
        `send_event(${type}) expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    this.lastProjection = body as FlowProjection;
    return this.lastProjection;
  }
}

// Helper: extracts org_id from a JWT without verifying the signature.
// Tests don't need to verify — the auth-proxy already did.
function decodeJwtOrgIdUnchecked(jwt: string): string | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as { org_id?: string };
    return payload.org_id ?? null;
  } catch {
    return null;
  }
}
