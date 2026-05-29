// UserFlowHarness — TS acceptance harness for J-001 (login-and-org-setup) and
// J-002 (project-and-chat-session-management).
//
// First-class deliverable of US-004. The harness is itself a test target:
// the @us-004 scenarios in `harness-drives-every-sign-in-and-org-setup-transition.feature`
// drive THROUGH this harness to verify its public surface matches the
// contract Maya-shaped + Rajesh-shaped tests need.
//
// ADR-046 MR-6 — the harness reads ONE `/state` document and writes ONE event
// surface, instead of the three former per-machine projection/event mounts:
//   - reads   : `GET  /ui-state/state`         → ChatAppStateDocument
//   - writes  : `POST /ui-state/state/events`  → {type, payload} ⇒ new document
// Each public method maps the document down to ITS region slice (onboarding /
// projectContext / sessionChat) + the single top-level `active_scope`, so the
// journey assertions callers make are unchanged — only the wire shape the
// harness reads/writes moved. Identity is header-derived (auth-proxy injects
// `X-User-Id`); there is no `flow_id` on the wire (ADR-046 Decision 1B).
//
// All harness methods route through auth-proxy (CM-A: driving port only).
// No method imports from ui-state/lib/**.

import { request } from "undici";

import type {
  ActiveScope,
  ChatAppStateDocument,
  FlowProjection,
  RegionKey,
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
}

// ────────────────────────────────────────────────────────────────────────────
// Shared `/state` transport. Both J-001 and J-002 harnesses observe the SAME
// per-principal document; each slices the region it owns.
// ────────────────────────────────────────────────────────────────────────────

/** GET /ui-state/state — the current ChatAppStateDocument (`.getSnapshot`). */
async function fetchStateDocument(
  authProxyUrl: string,
): Promise<ChatAppStateDocument> {
  const res = await request(`${authProxyUrl}/ui-state/state`, { method: "GET" });
  const body = (await res.body.json()) as unknown;
  if (res.statusCode !== 200) {
    throw new Error(
      `GET /ui-state/state expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
    );
  }
  return body as ChatAppStateDocument;
}

/** POST /ui-state/state/events — submit one event (`.send`); the response IS
 *  the new document. */
async function postStateEvent(
  authProxyUrl: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<ChatAppStateDocument> {
  const res = await request(`${authProxyUrl}/ui-state/state/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  const body = (await res.body.json()) as unknown;
  if (res.statusCode !== 200) {
    throw new Error(
      `POST /ui-state/state/events (${type}) expected 200, got ${res.statusCode}: ${JSON.stringify(body)}`,
    );
  }
  return body as ChatAppStateDocument;
}

/** Flatten a region slice of the document into the FlowProjection shape the
 *  harness exposes: the region's `{state, context}` + the document's single
 *  top-level `active_scope`/bookkeeping (`correlation_id` ← `request_id`). */
function regionProjection(
  doc: ChatAppStateDocument,
  region: RegionKey,
): FlowProjection {
  const slice = doc.regions[region];
  return {
    state: slice.state,
    context: slice.context,
    active_scope: doc.active_scope,
    sequence_id: doc.sequence_id,
    last_event_at: doc.last_event_at,
    correlation_id: doc.request_id,
  };
}

export class UserFlowHarness {
  private correlationId: string | null = null;
  private started = false;
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
    // Begin is no longer a standalone route — it is the reserved `session_begin`
    // event on the one event surface (ADR-046 Decision 3a). `force_restart`
    // cold-starts the per-principal actor into onboarding; the persona +
    // simulation knobs ride the event payload exactly as the old /begin body
    // carried them.
    const doc = await postStateEvent(
      this.config.authProxyUrl,
      "session_begin",
      {
        force_restart: true,
        persona_email: this.persona.email,
        persona_display_name: this.persona.display_name,
        existing_org_names: options.existing_org_names,
        force_reissue_failures: options.force_reissue_failures,
      },
    );
    this.started = true;
    this.correlationId = doc.request_id;
    const projection = regionProjection(doc, "onboarding");
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
   * Attach this harness to the existing per-principal document without driving
   * begin_auth. Used by US-004's composition scenario: a sibling harness reads
   * the existing onboarding region rather than re-running sign-in. Since the
   * `/state` actor is addressed by header identity (no `flow_id`), attaching is
   * just "treat the flow as already started" — the sibling reads the same
   * document the primary established.
   */
  attach_to_flow(correlation_id: string): void {
    this.started = true;
    this.correlationId = correlation_id;
  }

  /**
   * Read the access_token out of the onboarding region's context (the ui-state
   * tier mints one on the org_created_and_jwt_reissued transition). Idempotent
   * and tolerant of projections that don't yet carry one.
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
   * server-known current project name and a (possibly stale) bookmarked name.
   * Deep-link is now the ordinary `open_deep_link` event (ADR-046 Decision 3);
   * it re-enters scope resolution in the project-context region, so the result
   * is read off that region's slice.
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
    if (!this.started) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const doc = await postStateEvent(
      this.config.authProxyUrl,
      "open_deep_link",
      {
        intent_project_id: input.route.project,
        intent_resource_id: input.route.resource_id,
        intent_resource_type: input.route.resource_type,
        // The legacy route carried org + (current/bookmarked) names that the
        // new event envelope does not model; forwarded verbatim — the server
        // ignores unmodeled payload fields (research Finding 4).
        intent_org_id: input.route.org,
        project_name: input.project_name,
        bookmarked_project_name: input.bookmarked_project_name,
      },
    );
    this.lastProjection = regionProjection(doc, "projectContext");
    return this.lastProjection;
  }

  /**
   * Assert that the most recent deep-link resolution emitted a
   * scope_reconciled signal (I5 from ADR-029). Reads
   * regions.projectContext.context.scope_reconciled from the document.
   */
  async assert_scope_reconciled(): Promise<void> {
    const doc = await this.get_document();
    const ctx = doc.regions.projectContext.context as {
      scope_reconciled?: boolean;
    };
    if (!ctx.scope_reconciled) {
      throw new Error(
        `assert_scope_reconciled failed: regions.projectContext.context.scope_reconciled is ${ctx.scope_reconciled}, expected true`,
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
    if (!this.started) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const doc = await this.get_document();
    const scope = doc.active_scope;
    const res = await request(
      `${this.config.authProxyUrl}/agent/chat-turn`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-active-scope": JSON.stringify(scope),
        },
        body: JSON.stringify({}),
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

  /** The current document. */
  private async get_document(): Promise<ChatAppStateDocument> {
    if (!this.started) {
      throw new Error("No active flow; call begin_auth() first");
    }
    return fetchStateDocument(this.config.authProxyUrl);
  }

  /** The onboarding region slice — the J-001 harness's home view. */
  async get_projection(): Promise<FlowProjection> {
    const doc = await this.get_document();
    this.lastProjection = regionProjection(doc, "onboarding");
    return this.lastProjection;
  }

  get_last_correlation_id(): string | null {
    return this.correlationId;
  }

  private async send_event(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<FlowProjection> {
    if (!this.started) {
      throw new Error("No active flow; call begin_auth() first");
    }
    const doc = await postStateEvent(this.config.authProxyUrl, type, payload);
    this.correlationId = doc.request_id;
    this.lastProjection = regionProjection(doc, "onboarding");
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
//
// Post ADR-046 MR-6 the J-002 harness reads the SAME `/state` document as
// J-001, slicing the `projectContext` region (project switching, deep links,
// scope mismatch) and the `sessionChat` region (session list, resume,
// transcript, dataset context). There is no per-machine `flow_id` on the wire
// any more; the single top-level `active_scope` carries org + project +
// resource (deepest-resolved wins), so resource_* reads come straight off it.
//
// FREEZE/THAW remain on their own gated test-wire endpoints (index.ts
// §/freeze + /thaw, keyed by principal_id) — they are not part of the `/state`
// read/write/stream triad and are out of MR-6's scope.
//
// REC-2 decision: this harness is INVOKED via inline ESM scripts (Option B).
// driver.py's `run_ts_harness` constructs an inline ESM string that
// `import { userFlowHarness } from ...` + drives the ops + emits JSON on stdout.
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
  constructor(private readonly config: J002HarnessConfig) {}

  // ──────────────── transport over the one `/state` surface ────────────────

  private async getDocument(): Promise<ChatAppStateDocument> {
    return fetchStateDocument(this.config.authProxyUrl);
  }

  private async sendEvent(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<ChatAppStateDocument> {
    return postStateEvent(this.config.authProxyUrl, type, payload);
  }

  /** Spawn / re-attach J-002 for this principal. Begin is the reserved
   *  `session_begin` event now; returns the project-context region slice. */
  async begin(personaDisplayName: string = "Maya Chen"): Promise<FlowProjection> {
    const doc = await this.sendEvent("session_begin", {
      force_restart: true,
      persona_display_name: personaDisplayName,
    });
    return regionProjection(doc, "projectContext");
  }

  /** Submit `switching_project_intent` for the named project. */
  async open_project(project_id: string): Promise<FlowProjection> {
    return this.sendProjectContextEvent("switching_project_intent", {
      new_project_id: project_id,
    });
  }

  /** Open a deep link with the given intent. */
  async open_deep_link(intent: J002OpenDeepLinkIntent): Promise<FlowProjection> {
    const doc = await this.sendEvent("open_deep_link", {
      intent_project_id: intent.project_id,
      intent_session_id: intent.session_id,
      intent_resource_id: intent.resource_id,
      intent_resource_type: intent.resource_type,
    });
    return regionProjection(doc, "projectContext");
  }

  /** Submit `create_project_submitted` with the given name. Assumes the
   *  machine is currently in `no_projects`. */
  async create_first_project(name: string): Promise<FlowProjection> {
    return this.sendProjectContextEvent("create_project_submitted", {
      org_name: name,
    });
  }

  /** Read the current J-002 project-context region slice. */
  async get_projection(): Promise<FlowProjection> {
    return regionProjection(await this.getDocument(), "projectContext");
  }

  /** Assert that the resolver picked the project with the given id OR name.
   *  Reads from the project-context region — never queries the backend. */
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
   *  Post ADR-046 the document carries ONE authoritative top-level
   *  `active_scope` (deepest-resolved region wins), so org/project AND
   *  resource_* are all read from it directly — no per-machine overlay. */
  async assert_scope(expected: Partial<ActiveScope>): Promise<void> {
    const actual: ActiveScope = (await this.getDocument()).active_scope;
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

  // ──────────────── session-chat region ops (DWD-13 §2B) ────────────────
  //
  // The session-chat data is now the `sessionChat` region slice of the one
  // document (was `session-chat:<principal>` per-machine projection). The
  // orchestrator's `project_ready` broadcast still auto-materializes it on the
  // project-context `project_selected` entry.

  /** Read the session-chat region slice. */
  async get_session_chat_projection(): Promise<FlowProjection> {
    return regionProjection(await this.getDocument(), "sessionChat");
  }

  // ───────────────── MR-6 / US-210 cross-machine FREEZE/THAW ──────────────
  // FREEZE/THAW remain on their own gated test-wire endpoints (index.ts
  // §/freeze + /thaw, keyed by principal_id). They simulate J-001's
  // expired_token → silent-reauth lifecycle drives and are NOT part of the
  // `/state` read/write/stream surface (ADR-046 MR-6 scope). J-002 is a pure
  // downstream consumer (ADR-028:46-48).

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
   *  (observability-only — reads the session-chat region's last_stale_intent,
   *  the SSOT the orchestrator wrote at replay). */
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
   *  at 30 per page). Calls into the session-chat region. */
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

  /** Resume the given session — drives `session_clicked`. Returns the
   *  session-chat region slice after settle. */
  async resume_session(session_id: string): Promise<FlowProjection> {
    const doc = await this.sendEvent("session_clicked", { session_id });
    return regionProjection(doc, "sessionChat");
  }

  /** Read the current transcript from the session-chat region. */
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

  /** Assert that the session-chat region is in `session_active` with the
   *  given session_id. */
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
    const doc = await this.sendEvent("new_session_clicked", {});
    return regionProjection(doc, "sessionChat");
  }

  /** US-206 — send the first message; eagerly creates the session row and
   *  PATCHes title = `content[:80]`. Returns the session-chat slice. */
  async send_first_message(content: string): Promise<FlowProjection> {
    const doc = await this.sendEvent("first_message_sent", { content });
    return regionProjection(doc, "sessionChat");
  }

  /** Drive `refresh_session_list` — re-reads the backend list and re-emits
   *  the session_list_loaded event. */
  async refresh_session_list(): Promise<FlowProjection> {
    const doc = await this.sendEvent("refresh_session_list", {});
    return regionProjection(doc, "sessionChat");
  }

  // ──────────────── MR-4 ops (US-207 + US-208 + IC-J002-4/7) ────────────
  //
  // `switch_project` drives the project-context machine's
  // `switching_project_intent` event; the agent-related assertions read the
  // agent's request log via the harness debug endpoint.

  /** US-207 — drive `switching_project_intent` for the named project. */
  async switch_project(target_project_id: string): Promise<FlowProjection> {
    return this.sendProjectContextEvent("switching_project_intent", {
      new_project_id: target_project_id,
    });
  }

  /** US-208 — verify the agent's most recent chat-turn received an
   *  `X-Active-Scope` header matching the expected shape. Reads via the
   *  agent's harness-only `/debug/request-log` endpoint, which is enabled
   *  by `NWAVE_HARNESS_KNOBS=true`. */
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
   *  carrying a mismatched (project_id, session_id) pair. */
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
    // For each project_id we've seen, the set of session_ids paired with that
    // project_id should not overlap with the set paired with any other
    // project_id. A mismatched pair surfaces as an overlap.
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
   *  context.underlying_cause_tag === expected_cause (project-context region). */
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
   *  `dataset_resolved_by_agent` and wait for the
   *  `switching_dataset_context → session_active` settle. */
  async attach_dataset_via_agent(
    dataset_name: string,
  ): Promise<FlowProjection> {
    const datasetId = await this.resolveDatasetIdByName(dataset_name);
    return this.sendSessionChatDatasetEvent(
      "dataset_resolved_by_agent",
      datasetId,
    );
  }

  /** Direct UI selection path: emit `dataset_picked_directly`. */
  async attach_dataset_directly(
    dataset_id: string,
  ): Promise<FlowProjection> {
    return this.sendSessionChatDatasetEvent(
      "dataset_picked_directly",
      dataset_id,
    );
  }

  /** POST a dataset pick event and poll the session-chat region until it
   *  re-settles in `session_active`. */
  private async sendSessionChatDatasetEvent(
    type: "dataset_resolved_by_agent" | "dataset_picked_directly",
    dataset_id: string,
  ): Promise<FlowProjection> {
    await this.sendEvent(type, {
      resource_id: dataset_id,
      resource_type: "dataset",
    });
    for (let i = 0; i < 80; i++) {
      const sc = await this.get_session_chat_projection();
      if (sc.state === "session_active") return sc;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `j002.${type}: session-chat never re-settled in session_active`,
    );
  }

  /** Mint a dev JWT via auth-proxy's public `/api/auth/callback` and list the
   *  active project's datasets to map a dataset NAME → id. The project id is
   *  read off the session-chat region's context. */
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
      items?: Array<{ id?: string; name?: string; attributes?: { name?: string } }>;
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

  /** Post a project-context event and return the project-context region slice. */
  private async sendProjectContextEvent(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<FlowProjection> {
    const doc = await this.sendEvent(type, payload);
    return regionProjection(doc, "projectContext");
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
