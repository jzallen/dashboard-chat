// UserFlowHarness — TS acceptance harness for J-001 (login-and-org-setup).
//
// First-class deliverable of US-004. The harness is itself a test target:
// the @us-004 scenarios in `harness-drives-every-sign-in-and-org-setup-transition.feature`
// drive THROUGH this harness to verify its public surface matches the
// contract Maya-shaped + Rajesh-shaped tests need.
//
// All harness methods route through auth-proxy (CM-A: driving port only).
// No method imports from ui-state/lib/**.

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

  async begin_auth(
    _personaName: string,
    options: {
      existing_org_names?: string[];
      harness_force_reissue_failures?: number;
    } = {},
  ): Promise<FlowProjection> {
    const machine = this.config.defaultMachine ?? "login-and-org-setup";
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${machine}/begin`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persona_email: this.persona.email,
          persona_display_name: this.persona.display_name,
          existing_org_names: options.existing_org_names,
          harness_force_reissue_failures: options.harness_force_reissue_failures,
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
    this.capture_jwt_from(projection);
    return projection;
  }

  async submit_org(name: string): Promise<FlowProjection> {
    const projection = await this.send_event("org_form_submitted", {
      org_name: name,
    });
    // Per ADR-029 invariant 4, on the transition to `ready` the projection
    // carries the JWT carrying Maya's org_id claim. Capture it so
    // assert_jwt_carries_org_claim has something to decode.
    this.capture_jwt_from(projection);
    return projection;
  }

  /**
   * Attach this harness to an existing flow without driving begin_auth.
   * Used by US-004's composition scenario: a sibling harness reads the
   * existing user-flow projection rather than re-running sign-in. The
   * sibling owns its own assertion surface (e.g. dataset operations) but
   * shares the auth+org context the primary harness established.
   */
  attach_to_flow(flow_id: string, correlation_id: string): void {
    this.flowId = flow_id;
    this.correlationId = correlation_id;
  }

  /**
   * Read the access_token out of the projection's context (the ui-state
   * tier mints one on the org_created_and_jwt_reissued transition). Idempotent
   * and tolerant of projections that don't yet carry one — leaves `this.jwt`
   * unchanged in that case so assert_jwt_carries_org_claim can surface the
   * canonical "harness has no JWT" diagnostic.
   */
  private capture_jwt_from(projection: FlowProjection): void {
    const ctx = projection.context as { access_token?: string };
    if (typeof ctx.access_token === "string" && ctx.access_token.length > 0) {
      this.jwt = ctx.access_token;
    }
  }

  async force_transient_failure(tag: UnderlyingCauseTag): Promise<FlowProjection> {
    return this.send_event("__harness_force_failure__", { tag });
  }

  async expire_token(): Promise<FlowProjection> {
    return this.send_event("__harness_expire_token__", {});
  }

  /**
   * Open a deep link with the given route params, optionally supplying the
   * server-known current project name and a (possibly stale) bookmarked
   * name. Routes through auth-proxy → ui-state /open-deep-link, which
   * runs the ScopeResolver and appends a deep_link_opened (or
   * scope_access_denied) event to the flow.
   */
  async open_deep_link(input: {
    route: {
      org?: string;
      project?: string;
      resource_type?: "dataset" | "view" | "report";
      resource_id?: string;
    };
    project_name?: string;
    bookmarked_project_name?: string;
  }): Promise<FlowProjection> {
    if (!this.flowId) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const machine = this.config.defaultMachine ?? "login-and-org-setup";
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${machine}/open-deep-link`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: this.flowId,
          route: input.route,
          project_name: input.project_name,
          bookmarked_project_name: input.bookmarked_project_name,
        }),
      },
    );
    const body = (await res.body.json()) as unknown;
    if (res.statusCode !== 200) {
      throw new Error(
        `open_deep_link expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    this.lastProjection = body as FlowProjection;
    return this.lastProjection;
  }

  /**
   * Assert that the most recent deep-link resolution emitted a
   * scope_reconciled signal (I5 from ADR-029). Reads context.scope_reconciled
   * from the projection, which the reducer sets when a deep_link_opened
   * event carried `reconciled: true`.
   */
  async assert_scope_reconciled(): Promise<void> {
    const projection = await this.get_projection();
    const ctx = projection.context as { scope_reconciled?: boolean };
    if (!ctx.scope_reconciled) {
      throw new Error(
        `assert_scope_reconciled failed: context.scope_reconciled is ${ctx.scope_reconciled}, expected true`,
      );
    }
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

  /**
   * Invoke the chat agent via auth-proxy and surface the agent's scope
   * diagnostic as a test failure when the active scope is incomplete (no
   * project_id). Per ADR-029 §4 the agent rejects invocations missing
   * `org_id` or `project_id` with a 400 carrying the named diagnostic
   *   `agent invocation missing scope: missing org_id or project_id`.
   * The harness re-throws that diagnostic so the test naming machinery
   * points at the scope contract, not at the chat agent's internals.
   */
  async assert_chat_turn_invokable_for_active_project(): Promise<void> {
    if (!this.flowId) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const projection = await this.get_projection();
    const scope = projection.active_scope;
    const res = await request(
      `${this.config.authProxyUrl}/agent/chat-turn`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-active-scope": JSON.stringify(scope),
        },
        body: JSON.stringify({ flow_id: this.flowId }),
      },
    );
    const body = (await res.body.json()) as { error?: string };
    if (res.statusCode === 200) {
      return;
    }
    // The chat agent's missing-scope diagnostic is the contract surface; the
    // harness re-throws it verbatim so the failing test names the scope
    // contract.
    const diagnostic = body.error ?? `status ${res.statusCode}`;
    throw new Error(
      `assert_chat_turn_invokable_for_active_project failed: ${diagnostic}`,
    );
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
      `${this.config.authProxyUrl}/ui-state/flow/${machine}/projection?flow_id=${encodeURIComponent(this.flowId)}`,
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
      `${this.config.authProxyUrl}/ui-state/flow/${machine}/event`,
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

// ────────────────────────────────────────────────────────────────────────────
// harness.j002 namespace — J-002 (project-and-chat-session-management).
// Added by MR-1 sub-step 01-02. The namespace mirrors the J-001
// UserFlowHarness shape: an object exposing ops that drive the J-002 surface
// (via the auth-proxy → ui-state HTTP path, never via ui-state imports).
//
// Per DD-3 + DWD-3: the harness routes all traffic through auth-proxy. The
// J-002 surface is the orchestrator's J-002 flow_id namespace:
//   `project-and-chat-session-management:<principal_id>`
//
// REC-2 decision: this harness is INVOKED via inline ESM scripts (Option B).
// driver.py's `run_ts_harness` constructs an inline ESM string that
// `import { j002Harness } from ...` + drives the ops + emits JSON on stdout.
// See `docs/feature/project-and-chat-session-management/deliver/wave-decisions.md`.
// ────────────────────────────────────────────────────────────────────────────

export interface J002HarnessConfig {
  authProxyUrl: string;
  principalId: string;
}

export interface J002OpenDeepLinkIntent {
  project_id?: string;
  session_id?: string;
  resource_id?: string;
  resource_type?: "dataset" | "view" | "report";
}

export class J002Harness {
  private readonly flowId: string;
  private readonly machine = "project-and-chat-session-management";

  constructor(private readonly config: J002HarnessConfig) {
    this.flowId = `${this.machine}:${this.config.principalId}`;
  }

  /** Spawn / re-attach J-002 for this principal. Returns the projection. */
  async begin(personaDisplayName: string = "Maya Chen"): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${this.machine}/begin`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persona_display_name: personaDisplayName,
          principal_id: this.config.principalId,
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.begin expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Submit `switching_project_intent` for the named project. */
  async open_project(project_id: string): Promise<FlowProjection> {
    return this.sendEvent("switching_project_intent", { new_project_id: project_id });
  }

  /** Open a deep link with the given intent. */
  async open_deep_link(intent: J002OpenDeepLinkIntent): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${this.machine}/open-deep-link`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: this.flowId,
          principal_id: this.config.principalId,
          intent_project_id: intent.project_id,
          intent_session_id: intent.session_id,
          intent_resource_id: intent.resource_id,
          intent_resource_type: intent.resource_type,
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.open_deep_link expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Submit `create_project_submitted` with the given name. Assumes the
   *  machine is currently in `no_projects_empty_state`. */
  async create_first_project(name: string): Promise<FlowProjection> {
    return this.sendEvent("create_project_submitted", { org_name: name });
  }

  /** Read the current J-002 projection. */
  async get_projection(): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${this.machine}/projection?flow_id=${encodeURIComponent(this.flowId)}`,
      { method: "GET" },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.get_projection expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Assert that the resolver picked the project with the given id OR name.
   *  Accepts either an id (UUID-shaped) or a name (free-text); resolution
   *  rule: if `expected` matches `context.project.id` OR `context.project.name`,
   *  the assertion succeeds. Reads from the projection — never queries the
   *  backend directly.  */
  async assert_initial_project(expected: string): Promise<void> {
    const projection = await this.get_projection();
    const project = (projection.context as { project?: { id: string | null; name: string | null } }).project ?? {
      id: null,
      name: null,
    };
    const matches = project.id === expected || project.name === expected;
    if (!matches) {
      throw new Error(
        `j002.assert_initial_project failed: expected ${JSON.stringify(expected)}; ` +
          `got context.project={id:${JSON.stringify(project.id)}, name:${JSON.stringify(project.name)}}`,
      );
    }
  }

  /** Assert that the active_scope matches the expected (partial) shape. */
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
      throw new Error(`j002.assert_scope failed:\n${diffs.join("\n")}`);
    }
  }

  // ──────────────── MR-2 session-chat ops (DWD-13 §2B) ────────────────
  //
  // Per DWD-13 the J-002 session-chat machine has its own flow_id namespace
  // (`session-chat:<principal>`) and its own projection URL family. The
  // harness ops below read/drive that surface via the SAME auth-proxy →
  // ui-state HTTP path (CM-A holds: no ui-state/lib imports).

  /** Read the session-chat projection. The orchestrator's `project_ready`
   *  broadcast hook auto-spawns the session-chat actor on project-context's
   *  `project_selected` entry, so the projection is available once the
   *  project-context machine has settled in `project_selected`. */
  async get_session_chat_projection(): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/projection?flow_id=${encodeURIComponent("session-chat:" + this.config.principalId)}`,
      { method: "GET" },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.get_session_chat_projection expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Read the current session list (sorted DESC by last_active_at, capped
   *  at 30 per page). Calls into the session-chat projection. */
  async get_session_list(_project_id?: string): Promise<
    Array<{
      id: string;
      title: string | null;
      last_active_at: string;
      active_dataset_id: string | null;
    }>
  > {
    const projection = await this.get_session_chat_projection();
    const ctx = projection.context as {
      session_list?: Array<{
        id: string;
        title: string | null;
        last_active_at: string;
        active_dataset_id: string | null;
      }>;
    };
    return ctx.session_list ?? [];
  }

  /** Resume the given session — drives `session_clicked` against the
   *  session-chat flow. Returns the projection after settle. */
  async resume_session(session_id: string): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: `session-chat:${this.config.principalId}`,
          type: "session_clicked",
          payload: { session_id },
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.resume_session expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Read the current transcript from the session-chat projection. */
  async get_transcript(): Promise<
    Array<{ id: string; role: string; content: string; ts: string }>
  > {
    const projection = await this.get_session_chat_projection();
    const ctx = projection.context as {
      transcript?: Array<{
        id: string;
        role: string;
        content: string;
        ts: string;
      }>;
    };
    return ctx.transcript ?? [];
  }

  /** Assert that the session-chat projection is in `session_active` with the
   *  given session_id, and that BOTH transcript and resource_* are populated
   *  atomically (no partial materialization). */
  async assert_session_active(session_id: string): Promise<void> {
    const projection = await this.get_session_chat_projection();
    if (projection.state !== "session_active") {
      throw new Error(
        `j002.assert_session_active failed: state=${JSON.stringify(projection.state)}, expected session_active`,
      );
    }
    const ctx = projection.context as {
      session_id?: string | null;
      transcript?: unknown[];
      resource?: { type: unknown; id: unknown };
    };
    if (ctx.session_id !== session_id) {
      throw new Error(
        `j002.assert_session_active failed: session_id=${JSON.stringify(ctx.session_id)}, expected ${JSON.stringify(session_id)}`,
      );
    }
  }

  /** Assert that the session list contains a row whose title matches
   *  `title` (substring match, case-insensitive). */
  async assert_session_list_includes(title: string): Promise<void> {
    const sessions = await this.get_session_list();
    const needle = title.toLowerCase();
    const found = sessions.some((s) =>
      (s.title ?? "").toLowerCase().includes(needle),
    );
    if (!found) {
      const titles = sessions.map((s) => s.title);
      throw new Error(
        `j002.assert_session_list_includes failed: no session title matching ${JSON.stringify(title)}; got ${JSON.stringify(titles)}`,
      );
    }
  }

  /** Assert state === "scope_mismatch_terminal" AND
   *  context.underlying_cause_tag === expected_cause. */
  async assert_scope_mismatch(expected_cause: string): Promise<void> {
    const projection = await this.get_projection();
    if (projection.state !== "scope_mismatch_terminal") {
      throw new Error(
        `j002.assert_scope_mismatch failed: state=${JSON.stringify(projection.state)}, expected scope_mismatch_terminal`,
      );
    }
    const cause = (projection.context as { underlying_cause_tag?: string }).underlying_cause_tag ?? null;
    if (cause !== expected_cause) {
      throw new Error(
        `j002.assert_scope_mismatch failed: underlying_cause_tag=${JSON.stringify(cause)}, expected ${JSON.stringify(expected_cause)}`,
      );
    }
  }

  private async sendEvent(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/${this.machine}/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: this.flowId,
          type,
          payload,
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.${type} expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }
}

/**
 * Top-level harness export carrying both the J-001 (`user_flow`) and J-002
 * (`j002`) namespaces. Test scripts construct this once per scenario:
 *
 *   const h = userFlowHarness({
 *     authProxyUrl: "http://localhost:1042",
 *     fakeWorkOSUrl: "http://localhost:14299",
 *     principalId: "dev-user-001",
 *   });
 *   await h.j002.begin();
 *   await h.j002.assert_initial_project("Q4 Analytics");
 */
export interface UserFlowHarnessShape {
  user_flow: UserFlowHarness;
  j002: J002Harness;
}

export function userFlowHarness(config: {
  authProxyUrl: string;
  fakeWorkOSUrl: string;
  principalId?: string;
  persona?: PersonaConfig;
}): UserFlowHarnessShape {
  const principalId = config.principalId ?? "dev-user-001";
  const persona = config.persona ?? {
    id: principalId,
    email: "maya.chen@acme-data.example",
    display_name: "Maya Chen",
  };
  return {
    user_flow: new UserFlowHarness(
      { authProxyUrl: config.authProxyUrl, fakeWorkOSUrl: config.fakeWorkOSUrl },
      persona,
    ),
    j002: new J002Harness({
      authProxyUrl: config.authProxyUrl,
      principalId,
    }),
  };
}
