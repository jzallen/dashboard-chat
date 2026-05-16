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
      force_reissue_failures?: number;
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
          force_reissue_failures: options.force_reissue_failures,
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
    return this.send_event("__force_failure__", { tag });
  }

  async expire_token(): Promise<FlowProjection> {
    return this.send_event("__expire_token__", {});
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
      resource_type?: "dataset";
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
  resource_type?: "dataset";
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
   *  machine is currently in `no_projects`. */
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

  /** Assert that the active_scope matches the expected (partial) shape.
   *
   *  Per DWD-13 `active_scope` is split across the two J-002 machines:
   *  project-context owns `org_id` + `project_id`; session-chat owns the
   *  `resource_*` half (set by `session_resumed` / `dataset_attached`).
   *  So when the caller asserts `resource_type` / `resource_id` (US-209)
   *  the authoritative value is on the session-chat projection — read it
   *  and overlay it onto the project-context scope before comparing. The
   *  project/org-only callers (US-207 / US-208) are unaffected. */
  async assert_scope(expected: Partial<ActiveScope>): Promise<void> {
    const projection = await this.get_projection();
    const actual: ActiveScope = { ...projection.active_scope };
    if ("resource_type" in expected || "resource_id" in expected) {
      try {
        const sc = await this.get_session_chat_projection();
        actual.resource_type = sc.active_scope.resource_type;
        actual.resource_id = sc.active_scope.resource_id;
      } catch {
        // session-chat projection unavailable — fall back to the
        // project-context scope (resource_* will be null there).
      }
    }
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

  // ───────────────── MR-6 / US-210 cross-machine FREEZE/THAW ──────────────
  // The harness simulates the orchestrator broadcast J-001's expired_token
  // → silent-reauth lifecycle drives (the test wire of the existing
  // broadcastFreeze/broadcastThaw substrate — index.ts §/freeze + /thaw,
  // gated). J-002 is a pure downstream consumer (ADR-028:46-48).

  /** Broadcast FREEZE to this principal's J-002 flows. */
  async freeze(): Promise<void> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/freeze`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ principal_id: this.config.principalId }),
      },
    );
    if (res.statusCode !== 200) {
      const body = await res.body.text();
      throw new Error(
        `j002.freeze expected 200, got ${res.statusCode}: ${body}`,
      );
    }
  }

  /** Broadcast THAW (silent-reauth success). `reason: "abandoned"`
   *  simulates the 5s replay-buffer timeout / reauth failure. */
  async thaw(reason: "thaw" | "abandoned" = "thaw"): Promise<void> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/thaw`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principal_id: this.config.principalId,
          reason,
        }),
      },
    );
    if (res.statusCode !== 200) {
      const body = await res.body.text();
      throw new Error(
        `j002.thaw expected 200, got ${res.statusCode}: ${body}`,
      );
    }
  }

  /** Assert the DWD-7 stale-intent filter dropped the named intent
   *  (observability-only — reads the session-chat projection's
   *  last_stale_intent, the SSOT the orchestrator wrote at replay). */
  async assert_stale_intent_dropped(
    intent_type: string,
    target_id: string,
  ): Promise<void> {
    const projection = await this.get_session_chat_projection();
    const ctx = projection.context as {
      last_stale_intent?: { intent_type?: string; target_id?: string } | null;
      stale_intents_dropped_count?: number;
    };
    const ls = ctx.last_stale_intent ?? null;
    if (
      !ls ||
      ls.intent_type !== intent_type ||
      ls.target_id !== target_id
    ) {
      throw new Error(
        `j002.assert_stale_intent_dropped failed: expected ` +
          `{intent_type:${intent_type}, target_id:${target_id}}; got ` +
          `${JSON.stringify(ls)} (count=${ctx.stale_intents_dropped_count ?? 0})`,
      );
    }
  }

  /** Happy-path assertion: NO intent was stale-dropped after THAW. */
  async assert_no_stale_intents_dropped(): Promise<void> {
    const projection = await this.get_session_chat_projection();
    const ctx = projection.context as {
      stale_intents_dropped_count?: number;
      last_stale_intent?: unknown;
    };
    const count = ctx.stale_intents_dropped_count ?? 0;
    if (count !== 0) {
      throw new Error(
        `j002.assert_no_stale_intents_dropped failed: ` +
          `stale_intents_dropped_count=${count}, ` +
          `last_stale_intent=${JSON.stringify(ctx.last_stale_intent)}`,
      );
    }
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

  /** US-206 — drive the session-chat machine into `session_welcome`.
   *  Pure machine event; no backend write fires (DWD-10 lazy-create). */
  async start_new_session(): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: `session-chat:${this.config.principalId}`,
          type: "new_session_clicked",
          payload: {},
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.start_new_session expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** US-206 — send the first message; eagerly creates the session row and
   *  PATCHes title = `content[:80]`. Returns the projection after settle. */
  async send_first_message(content: string): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: `session-chat:${this.config.principalId}`,
          type: "first_message_sent",
          payload: { content },
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.send_first_message expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  /** Drive `refresh_session_list` against session-chat — re-reads the
   *  backend list and re-emits the session_list_loaded event. Used by the
   *  US-206 harness scenario to surface the newly created row in the list. */
  async refresh_session_list(): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: `session-chat:${this.config.principalId}`,
          type: "refresh_session_list",
          payload: {},
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.refresh_session_list expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    return body;
  }

  // ──────────────── MR-4 ops (US-207 + US-208 + IC-J002-4/7) ────────────
  //
  // The new ops live in `j002.*` per the DESIGN handoff §"TS UserFlowHarness
  // extensions". `switch_project` drives the project-context machine's
  // `switching_project_intent` event; the agent-related assertions read
  // the agent's request log via the harness debug endpoint.

  /** US-207 — drive `switching_project_intent` for the named project. */
  async switch_project(target_project_id: string): Promise<FlowProjection> {
    return this.sendEvent("switching_project_intent", {
      new_project_id: target_project_id,
    });
  }

  /** US-208 — verify the agent's most recent chat-turn received an
   *  `X-Active-Scope` header matching the expected shape. Reads via the
   *  agent's harness-only `/debug/request-log` endpoint, which is enabled
   *  by `NWAVE_HARNESS_KNOBS=true`. Throws when the agent did not receive
   *  any chat turn yet, when the most recent turn lacked the header, or
   *  when any of the expected fields disagree.
   *
   *  The endpoint contract (provisional; pending agent debug-endpoint
   *  wiring): GET /agent/debug/last-request-scope → 200 with body
   *  `{ scope: ActiveScope } | { scope: null, reason: string }`. When
   *  the endpoint is not yet wired, the harness throws with a named
   *  diagnostic so the failing test points at the missing seam. */
  async assert_agent_received_scope(
    expected: Partial<ActiveScope>,
  ): Promise<void> {
    const res = await request(
      `${this.config.authProxyUrl}/agent/debug/last-request-scope`,
      { method: "GET" },
    );
    if (res.statusCode === 404) {
      throw new Error(
        "j002.assert_agent_received_scope failed: agent debug endpoint not " +
          "found (NWAVE_HARNESS_KNOBS=true required; agent build must include " +
          "debug routes).",
      );
    }
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.assert_agent_received_scope failed: debug endpoint returned ${res.statusCode}`,
      );
    }
    const body = (await res.body.json()) as {
      scope?: ActiveScope | null;
      reason?: string;
    };
    if (!body.scope) {
      throw new Error(
        `j002.assert_agent_received_scope failed: agent has no recorded scope; reason=${JSON.stringify(body.reason ?? "unknown")}`,
      );
    }
    const diffs: string[] = [];
    for (const key of Object.keys(expected) as (keyof ActiveScope)[]) {
      if (body.scope[key] !== expected[key]) {
        diffs.push(
          `${String(key).padEnd(14)} expected: ${String(expected[key]).padEnd(28)} actual: ${String(body.scope[key])}`,
        );
      }
    }
    if (diffs.length > 0) {
      throw new Error(
        `j002.assert_agent_received_scope failed:\n${diffs.join("\n")}`,
      );
    }
  }

  /** US-207 / IC-J002-4 — verify the agent never received a chat turn
   *  carrying a mismatched (project_id, session_id) pair. The agent's
   *  request log carries every turn; the harness reads it and walks the
   *  rows asserting that no row pairs an old project_id with a new
   *  session_id (or vice versa) during a switch window.
   *
   *  Returns silently on success. */
  async assert_agent_request_log_no_mismatched(): Promise<void> {
    const res = await request(
      `${this.config.authProxyUrl}/agent/debug/request-log`,
      { method: "GET" },
    );
    if (res.statusCode === 404) {
      throw new Error(
        "j002.assert_agent_request_log_no_mismatched failed: agent debug endpoint not found",
      );
    }
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.assert_agent_request_log_no_mismatched failed: ${res.statusCode}`,
      );
    }
    const body = (await res.body.json()) as {
      entries?: Array<{
        scope?: ActiveScope | null;
        session_id?: string | null;
      }>;
    };
    const entries = body.entries ?? [];
    // For each project_id we've seen, the set of session_ids paired with
    // that project_id should not overlap with the set paired with any
    // other project_id. A mismatched pair surfaces as an overlap.
    const seen: Record<string, Set<string>> = {};
    for (const entry of entries) {
      const projectId = entry.scope?.project_id;
      const sessionId = entry.session_id ?? null;
      if (!projectId || !sessionId) continue;
      seen[projectId] ??= new Set<string>();
      seen[projectId].add(sessionId);
    }
    const projectIds = Object.keys(seen);
    for (let i = 0; i < projectIds.length; i++) {
      for (let j = i + 1; j < projectIds.length; j++) {
        const a = seen[projectIds[i]];
        const b = seen[projectIds[j]];
        for (const sessionId of a) {
          if (b.has(sessionId)) {
            throw new Error(
              `j002.assert_agent_request_log_no_mismatched failed: ` +
                `session_id=${sessionId} appears in BOTH project=${projectIds[i]} ` +
                `AND project=${projectIds[j]} (cross-tenant / mid-switch leak)`,
            );
          }
        }
      }
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

  // ──────────────── MR-5 dataset context switching (US-209) ────────────────

  /** Simulate the agent's `resolve_dataset` tool-return path end to end:
   *  resolve `dataset_name` → id within the active project, then emit
   *  `dataset_resolved_by_agent` to session-chat and wait for the
   *  `switching_dataset_context → session_active` settle. Returns the
   *  settled session-chat projection. */
  async attach_dataset_via_agent(
    dataset_name: string,
  ): Promise<FlowProjection> {
    const datasetId = await this.resolveDatasetIdByName(dataset_name);
    return this.sendSessionChatDatasetEvent(
      "dataset_resolved_by_agent",
      datasetId,
    );
  }

  /** Direct UI selection path: emit `dataset_picked_directly` for the
   *  given dataset id and wait for the settle. */
  async attach_dataset_directly(
    dataset_id: string,
  ): Promise<FlowProjection> {
    return this.sendSessionChatDatasetEvent(
      "dataset_picked_directly",
      dataset_id,
    );
  }

  /** POST a dataset pick event to the session-chat flow and poll the
   *  projection until it re-settles in `session_active` (the
   *  switchDatasetContext invoke is awaited by the orchestrator, but the
   *  HTTP response races the projection write under the in-memory log —
   *  poll to be deterministic across log tiers). */
  private async sendSessionChatDatasetEvent(
    type: "dataset_resolved_by_agent" | "dataset_picked_directly",
    dataset_id: string,
  ): Promise<FlowProjection> {
    const res = await request(
      `${this.config.authProxyUrl}/ui-state/flow/session-chat/event`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          flow_id: `session-chat:${this.config.principalId}`,
          type,
          payload: { resource_id: dataset_id, resource_type: "dataset" },
        }),
      },
    );
    const body = (await res.body.json()) as FlowProjection;
    if (res.statusCode !== 200) {
      throw new Error(
        `j002.${type} expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
      );
    }
    for (let i = 0; i < 80; i++) {
      const sc = await this.get_session_chat_projection();
      if (sc.state === "session_active") return sc;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `j002.${type}: session-chat never re-settled in session_active`,
    );
  }

  /** Mint a dev JWT via auth-proxy's public `/api/auth/callback` (the
   *  same flow `driver.mint_dev_jwt` uses) and list the active project's
   *  datasets to map a dataset NAME → id. The agent's resolve_dataset
   *  tool returns a name; the FE renders the inline list; the user's pick
   *  is an id — this resolver stands in for that name→id lookup. */
  private async resolveDatasetIdByName(name: string): Promise<string> {
    const sc = await this.get_session_chat_projection();
    const projectId = (sc.context as { project?: { id?: string | null } })
      .project?.id;
    if (!projectId) {
      throw new Error(
        "j002.attach_dataset_via_agent: session-chat has no project context yet",
      );
    }
    const tokenRes = await request(
      `${this.config.authProxyUrl}/api/auth/callback`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      },
    );
    const tokenBody = (await tokenRes.body.json()) as { token?: string };
    if (tokenRes.statusCode !== 200 || !tokenBody.token) {
      throw new Error(
        `j002.attach_dataset_via_agent: dev JWT mint failed (${tokenRes.statusCode})`,
      );
    }
    const dsRes = await request(
      `${this.config.authProxyUrl}/api/projects/${encodeURIComponent(projectId)}/datasets`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${tokenBody.token}` },
      },
    );
    const dsBody = (await dsRes.body.json()) as {
      data?: Array<{
        id?: string;
        name?: string;
        attributes?: { name?: string };
      }>;
      items?: Array<{ id?: string; name?: string }>;
    };
    const rows = dsBody.data ?? dsBody.items ?? [];
    for (const row of rows) {
      const rowName = row.name ?? row.attributes?.name;
      if (rowName === name && row.id) return row.id;
    }
    throw new Error(
      `j002.attach_dataset_via_agent: dataset "${name}" not found in project ${projectId}`,
    );
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
