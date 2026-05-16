// buildProjection — pure fold from FlowEvent[] into the public projection
// shape declared by `design/handoff-design-to-distill.md` §4.
//
// The TS acceptance harness reads this shape; the FE renders from this shape;
// the acceptance tests assert against this shape. Single source of truth.
//
// Design choice: the projection is built by replaying events through a
// dispatch table (`EVENT_HANDLERS`) rather than by snapshotting the XState
// machine. This keeps the projection a PURE function (testable without an
// XState runtime) and gives the orchestrator + persistence layer a clear
// contract: events go in, the projection is the public read shape.

import type { ActiveScope, ResourceType } from "./active-scope.ts";

export interface FlowEvent {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

export interface FlowProjection {
  flow_id: string;
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
}

const EMPTY_SCOPE: ActiveScope = {
  org_id: "",
  project_id: null,
  resource_type: null,
  resource_id: null,
};

interface ReducedContext {
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  org: { id: string | null; name: string | null };
  /**
   * Per ADR-029, the projection's `context.project` carries the
   * authoritative (current) project name as known to the user's machine.
   * Populated by deep_link_opened / scope_reconciled / project_selected
   * / project_created events.
   */
  project: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  retries_count: number;
  org_validation_error: { kind: string; message: string } | null;
  /** Per ADR-029 I5: true when last deep-link reconciliation rewrote the
   *  bookmarked project name. The acceptance test agent inspects this. */
  scope_reconciled: boolean;
  /** Per ADR-029 I4: surfaced when a deep link to a foreign tenant's
   *  resource is rejected. Carries the named diagnostic. */
  scope_resolution_error: { reason: string } | null;
  /** The resolved scope from the most recent deep_link_opened event. The
   *  projection-level `active_scope` field is derived from this. */
  resolved_scope: ActiveScope | null;
  /** Per ADR-029 invariant 4: the access_token minted at the
   *  org_created_and_jwt_reissued boundary. The TS harness's
   *  assert_jwt_carries_org_claim reads this. */
  access_token: string | null;
  /** project-and-chat-session-management context — populated by j002_*
   *  event handlers. The shape mirrors the project flow machine's
   *  ProjectFlowMachineContext (subset relevant to projection consumers —
   *  full per-flow context lives in the actor). */
  pending_project_name: string;
  project_validation_error: { kind: string; message: string } | null;
  /** Per OQ-J002-5: per-project last_active_at map captured by
   *  resolveInitialScope. Empty when J-002 hasn't resolved yet. */
  most_recent_session_per_project: Record<string, string>;
  /** Per OQ-J002-5 degraded path: ids of projects whose list_sessions
   *  call 5xx-failed during last-used resolution. */
  last_used_resolution_degraded: { failed_project_ids: string[]; partial_result: boolean } | null;
  /** J-002 deep-link WISH payload (US-204 / DWD-9, post-MR-D split per
   *  audit §5 / §7 Tier-1 #2). Carries the URL-level user wish — what
   *  the user typed/landed on, not yet confirmed or denied. Cleared by
   *  back_to_projects_clicked. */
  deeplink_project_id: string | null;
  deeplink_session_id: string | null;
  /** Resource fields are still URL-fed but kept on the polymorphic
   *  prefix `intent_resource_*` for forward-compat with the
   *  `open_deep_link` event payload (whose key names rename in a
   *  follow-up MR). They no longer touch project-context's ctx — the
   *  projection is their only stable home. */
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;
  /** Click-captured resume target (session-chat half — MR-D split).
   *  Populated by session_clicked + carried into resuming_session;
   *  cleared by session_resumed / session_resume_not_found /
   *  switching_project_started. Pairs with the existing pending_*
   *  family (pending_project_name, pending_first_message). */
  pending_resume_session_id: string | null;
  // ── session-chat context (J-002 MR-2 + DWD-13 §2B) ─────────────────────
  // Project identity on the session-chat projection lives on the shared
  // `project: { id, name }` field above. Written here by
  // `project_context_inherited` (the orchestrator's `project_ready`
  // re-broadcast), the same shape project-context writes via
  // `project_selected`. Audit §7 #5 + §9 Q3: the `session_chat_project_*`
  // duplicate was collapsed — see the property test in
  // projection-property.test.ts for the agreement invariant.
  /** Sessions visible in the current project; populated on
   *  session_list_loaded. Sorted DESC by last_active_at. */
  session_list: Array<{
    id: string;
    title: string | null;
    last_active_at: string;
    active_dataset_id: string | null;
  }>;
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;
  /** Active session: populated on session_resumed. */
  session_id: string | null;
  transcript: Array<{
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    ts: string;
  }>;
  /** Active resource (dataset). Populated on session_resumed when
   *  active_dataset_id resolved successfully. */
  resource: { type: ResourceType | null; id: string | null };
  /** Surfaced when a resumed session's active_dataset_id 404s. Per US-205
   *  Example 3 the FE renders the conversational-mode chip. */
  session_dataset_unavailable: boolean;
  /** US-206 composer-state preservation: the welcome-state's pending first
   *  message, populated by `first_message_sent` and preserved across the
   *  `error_recoverable → retry_clicked → session_welcome` boundary
   *  per app-arch §6.4. */
  pending_first_message: string;
  // ── MR-6 / US-210 cross-machine FREEZE/THAW ──────────────────────────
  /** The live state the machine froze from; written by the per-machine
   *  `*_frozen` event, read by `*_thawed` to restore (DWD-2/DWD-6 — the
   *  history target is a queryable context field, not an XState history
   *  node, so the TS harness can assert on it). */
  last_live_state: string | null;
  /** Cumulative DWD-7 stale-intent drop counter (observability only —
   *  the muscle-memory click that no longer resolves post-THAW). */
  stale_intents_dropped_count: number;
  /** The most recent stale-dropped intent, for
   *  `harness.j002.assert_stale_intent_dropped(intent_type, target_id)`. */
  last_stale_intent: { intent_type: string; target_id: string } | null;
}

function initialContext(): ReducedContext {
  return {
    user: { email: null, display_name: null, first_name: null },
    org: { id: null, name: null },
    project: { id: null, name: null },
    underlying_cause_tag: null,
    retries_count: 0,
    org_validation_error: null,
    scope_reconciled: false,
    scope_resolution_error: null,
    resolved_scope: null,
    access_token: null,
    pending_project_name: "",
    project_validation_error: null,
    most_recent_session_per_project: {},
    last_used_resolution_degraded: null,
    deeplink_project_id: null,
    deeplink_session_id: null,
    intent_resource_id: null,
    intent_resource_type: null,
    pending_resume_session_id: null,
    session_list: [],
    session_list_next_cursor: null,
    session_list_has_more: false,
    session_id: null,
    transcript: [],
    resource: { type: null, id: null },
    session_dataset_unavailable: false,
    pending_first_message: "",
    last_live_state: null,
    stale_intents_dropped_count: 0,
    last_stale_intent: null,
  };
}

/**
 * Signature every entry in `EVENT_HANDLERS` must satisfy. Each handler
 * receives the current (state, context) and the event being applied, and
 * returns the next (state, context). Handlers are pure: same inputs, same
 * outputs, no side effects.
 *
 * Handlers may ignore any of the three arguments (use `_state` / `_context`
 * / `_event` to silence the unused-arg lint). Returning the inputs unchanged
 * is a valid no-op.
 */
type EventHandler = (
  state: string,
  context: ReducedContext,
  event: FlowEvent,
) => { state: string; context: ReducedContext };

/**
 * Dispatch table — strategy pattern. Each entry handles one event.type.
 * Adding a new event type means adding one entry here; no changes to
 * `applyEvent` or `buildProjection` are needed.
 *
 * Order below mirrors the J-001 state-chart progression so the file reads
 * as the flow's narrative: anonymous → authenticating → authenticated_no_org
 * → creating_org → ready → expired_token → (error states), then ADR-029
 * deep-link scope-resolution events.
 */
const EVENT_HANDLERS: Record<string, EventHandler> = {
  sign_in_clicked: (_state, context, _event) => ({
    state: "authenticating",
    context,
  }),

  auth_callback_resolved: (_state, context, event) => {
    const userPayload =
      (event.payload.user as Partial<ReducedContext["user"]>) ?? {};
    const displayName = userPayload.display_name ?? null;
    const firstName =
      userPayload.first_name ??
      (displayName ? displayName.split(/\s+/)[0] || null : null);
    return {
      state: "authenticated_no_org",
      context: {
        ...context,
        user: {
          email: userPayload.email ?? null,
          display_name: displayName,
          first_name: firstName,
        },
      },
    };
  },

  auth_failed: (_state, context, event) => {
    const cause =
      (event.payload.underlying_cause_tag as string | undefined) ?? null;
    return {
      state: "error_recoverable",
      context: { ...context, underlying_cause_tag: cause },
    };
  },

  // Submission enters creating_org transiently; the projection observed after
  // settle reflects the terminal state (ready / authenticated_no_org /
  // error_recoverable). Until that next event lands, the table shows
  // creating_org so a concurrent reader can see the "Creating..." state.
  org_form_submitted: (_state, context, _event) => ({
    state: "creating_org",
    context: { ...context, org_validation_error: null },
  }),

  validation_failed: (_state, context, event) => {
    const err =
      (event.payload.error as ReducedContext["org_validation_error"]) ?? null;
    return {
      state: "authenticated_no_org",
      context: { ...context, org_validation_error: err },
    };
  },

  org_created_and_jwt_reissued: (_state, context, event) => {
    const orgPayload =
      (event.payload.org as Partial<ReducedContext["org"]>) ?? {};
    const accessToken =
      (event.payload.access_token as string | undefined) ?? null;
    return {
      state: "ready",
      context: {
        ...context,
        org: {
          id: orgPayload.id ?? null,
          name: orgPayload.name ?? null,
        },
        org_validation_error: null,
        underlying_cause_tag: null,
        access_token: accessToken,
      },
    };
  },

  token_expired: (_state, context, _event) => ({
    state: "expired_token",
    context: { ...context },
  }),

  reissue_failed_partial: (_state, context, event) => {
    const cause =
      (event.payload.underlying_cause_tag as string | undefined) ??
      "partial-setup";
    const orgPayload =
      (event.payload.org as Partial<ReducedContext["org"]>) ?? {};
    return {
      state: "error_recoverable",
      context: {
        ...context,
        underlying_cause_tag: cause,
        org: {
          id: orgPayload.id ?? context.org.id,
          name: orgPayload.name ?? context.org.name,
        },
      },
    };
  },

  // Payload shape (mirrors `open_deep_link` handler in `index.ts`,
  // post-MR-D rename per audit §5 / §7 Tier-1 #2):
  //   { scope: ActiveScope, project: { id, name } | null, reconciled: bool,
  //     deeplink_project_id?, deeplink_session_id?,
  //     intent_resource_id?, intent_resource_type? }
  //
  // Per DWD-9: the J-002 deep-link wish fields are carried in the same
  // event payload so future MR consumers (session resume, dataset
  // switching) read them from the projection's context.
  deep_link_opened: (state, context, event) => {
    const payload = event.payload as {
      scope?: ActiveScope;
      project?: { id: string | null; name: string | null } | null;
      reconciled?: boolean;
      deeplink_project_id?: string | null;
      deeplink_session_id?: string | null;
      intent_resource_id?: string | null;
      intent_resource_type?: ResourceType | null;
    };
    const newProject = payload.project ?? null;
    return {
      state,
      context: {
        ...context,
        resolved_scope: payload.scope ?? null,
        project: newProject
          ? { id: newProject.id, name: newProject.name }
          : context.project,
        scope_reconciled: Boolean(payload.reconciled),
        scope_resolution_error: null,
        deeplink_project_id:
          payload.deeplink_project_id ?? context.deeplink_project_id,
        deeplink_session_id:
          payload.deeplink_session_id ?? context.deeplink_session_id,
        intent_resource_id:
          payload.intent_resource_id ?? context.intent_resource_id,
        intent_resource_type:
          payload.intent_resource_type ?? context.intent_resource_type,
      },
    };
  },

  // Defensive: a separate scope_reconciled event (vs. embedded in
  // deep_link_opened.reconciled) may be appended by future flows. Both
  // shapes land at the same projection field.
  scope_reconciled: (state, context, _event) => ({
    state,
    context: { ...context, scope_reconciled: true },
  }),

  scope_access_denied: (_state, context, event) => {
    const payload = event.payload as { reason?: string };
    return {
      state: "access_denied",
      context: {
        ...context,
        scope_resolution_error: {
          reason: payload.reason ?? "cross-tenant access",
        },
      },
    };
  },

  // ─────────────────── J-002 event handlers (MR-1 substrate) ──────────────
  // Per DWD-9 the FlowProjection envelope is UNCHANGED; J-002 fields live
  // inside `context.*`. The active_scope field is derived from context.org.id
  // and context.project below in buildProjection.

  project_context_resolution_started: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      user?: { first_name?: string | null };
    };
    return {
      state: "resolving_initial_scope",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        user: {
          ...context.user,
          first_name:
            payload.user?.first_name ?? context.user.first_name,
        },
      },
    };
  },

  no_projects_displayed: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      user?: { first_name?: string | null };
    };
    return {
      state: "no_projects",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        user: {
          ...context.user,
          first_name:
            payload.user?.first_name ?? context.user.first_name,
        },
        underlying_cause_tag: "no_projects",
        project_validation_error: null,
      },
    };
  },

  project_validation_failed: (state, context, event) => {
    const payload = event.payload as {
      error?: { kind: string; message: string };
    };
    return {
      state,
      context: {
        ...context,
        project_validation_error: payload.error ?? null,
      },
    };
  },

  project_creation_started: (_state, context, event) => {
    const payload = event.payload as { pending_project_name?: string };
    return {
      state: "creating_project",
      context: {
        ...context,
        pending_project_name:
          payload.pending_project_name ?? context.pending_project_name,
        project_validation_error: null,
      },
    };
  },

  project_created: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      project?: { id: string | null; name: string | null };
    };
    return {
      state: "project_selected",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        project: payload.project ?? context.project,
        underlying_cause_tag: null,
        project_validation_error: null,
      },
    };
  },

  project_selected: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      project?: { id: string | null; name: string | null };
      most_recent_session_per_project?: Record<string, string>;
    };
    return {
      state: "project_selected",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        project: payload.project ?? context.project,
        most_recent_session_per_project:
          payload.most_recent_session_per_project ??
          context.most_recent_session_per_project,
      },
    };
  },

  last_used_resolution_degraded: (state, context, event) => {
    const payload = event.payload as {
      failed_project_ids?: string[];
      partial_result?: boolean;
    };
    return {
      state,
      context: {
        ...context,
        last_used_resolution_degraded: {
          failed_project_ids: payload.failed_project_ids ?? [],
          partial_result: payload.partial_result ?? true,
        },
      },
    };
  },

  // ─────────────── MR-4 — project switching (US-207 + IC-J002-4) ────────
  // Per DESIGN §2A the project-context machine owns the `switching_project`
  // state. The IC-J002-4 invariant — session_id + resource_* MUST be
  // cleared BEFORE the new project's loading_session_list fires — is
  // enforced HERE in the projection layer (the cross-machine view): on
  // `switching_project_started` the projection writes nulls atomically.
  // Session-chat re-enters loading_session_list via the orchestrator's
  // project_ready re-broadcast on settle (`project_switched`).

  switching_project_started: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      deeplink_project_id?: string | null;
    };
    return {
      state: "switching_project",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        deeplink_project_id:
          payload.deeplink_project_id ?? context.deeplink_project_id,
        // IC-J002-4 atomic invalidation — write nulls in the SAME projection
        // tick the `switching_project` state surfaces. SSE consumers see the
        // (state, session_id=null, resource=null) tuple together.
        session_id: null,
        transcript: [],
        resource: { type: null, id: null },
        session_dataset_unavailable: false,
        deeplink_session_id: null,
        pending_resume_session_id: null,
        intent_resource_id: null,
        intent_resource_type: null,
        // D-MR4-06: a switch supersedes any prior deep-link-resolved scope.
        // `resolved_scope` takes precedence in the projection's
        // active_scope derivation (see buildProjection); if a stale
        // deep_link_opened scope survived the switch it would mask the
        // switched project's id. Clear it atomically with the rest of the
        // old-project invalidation so active_scope falls through to the
        // freshly-switched `context.project`.
        resolved_scope: null,
      },
    };
  },

  project_switched: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      project?: { id: string | null; name: string | null };
    };
    return {
      state: "project_selected",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        project: payload.project ?? context.project,
        // Session-chat half resets through the project_ready re-broadcast;
        // the projection-side fields are already cleared by
        // switching_project_started. Clear scope_resolution_error so a prior
        // scope_mismatch_terminal banner doesn't survive the switch.
        scope_resolution_error: null,
        underlying_cause_tag: null,
      },
    };
  },

  scope_mismatch_displayed: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      underlying_cause_tag?: string;
      deeplink_project_id?: string | null;
    };
    return {
      state: "scope_mismatch_terminal",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        underlying_cause_tag: payload.underlying_cause_tag ?? "cross_tenant",
        deeplink_project_id:
          payload.deeplink_project_id ?? context.deeplink_project_id,
      },
    };
  },

  project_context_recoverable_error: (_state, context, event) => {
    const payload = event.payload as {
      underlying_cause_tag?: string;
      pending_project_name?: string;
    };
    return {
      state: "error_recoverable",
      context: {
        ...context,
        underlying_cause_tag: payload.underlying_cause_tag ?? "transient",
        pending_project_name:
          payload.pending_project_name ?? context.pending_project_name,
      },
    };
  },

  // ───────────── session-chat handlers (J-002 MR-2, DWD-13 §2B) ──────────
  // Each handler keeps the FlowProjection envelope unchanged (DWD-9) and
  // writes session-chat fields under context.*. The session-chat flow's
  // event log carries these events on the `session-chat:<principal>` Redis
  // stream key — separate from the project-context flow's log.

  project_context_inherited: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      project_id?: string;
      project_name?: string;
    };
    return {
      state: "waiting_for_project",
      context: {
        ...context,
        org: { id: payload.org_id ?? context.org.id, name: context.org.name },
        project: {
          id: payload.project_id ?? context.project.id,
          name: payload.project_name ?? context.project.name,
        },
      },
    };
  },

  session_list_load_started: (_state, context, _event) => ({
    state: "loading_session_list",
    context: { ...context },
  }),

  session_list_loaded: (_state, context, event) => {
    const payload = event.payload as {
      items?: Array<{
        id: string;
        title: string | null;
        last_active_at: string;
        active_dataset_id: string | null;
      }>;
      next_cursor?: string | null;
      has_more?: boolean;
    };
    return {
      state: "session_list_loaded",
      context: {
        ...context,
        session_list: payload.items ?? [],
        session_list_next_cursor: payload.next_cursor ?? null,
        session_list_has_more: payload.has_more ?? false,
        // Loading session list invalidates the prior resumed session.
        session_id: null,
        transcript: [],
        resource: { type: null, id: null },
        session_dataset_unavailable: false,
      },
    };
  },

  // Emitted on session_list_loaded entry (separate from session_list_loaded
  // so consumers can distinguish "list refreshed" from "first paint").
  session_list_displayed: (_state, context, _event) => ({
    state: "session_list_loaded",
    context: { ...context },
  }),

  session_resume_started: (_state, context, event) => {
    const payload = event.payload as { session_id?: string };
    return {
      state: "resuming_session",
      context: {
        ...context,
        // Capture the click-pending resume target so the FE can render
        // the "resuming…" hint (MR-D split — was intent_session_id).
        pending_resume_session_id:
          payload.session_id ?? context.pending_resume_session_id,
      },
    };
  },

  session_resumed: (_state, context, event) => {
    const payload = event.payload as {
      session_id?: string;
      transcript?: Array<{ id: string; role: string; content: string; ts: string }>;
      resource_type?: ResourceType | null;
      resource_id?: string | null;
      dataset_unavailable?: boolean;
    };
    const transcript = (payload.transcript ?? []).map((m) => ({
      id: m.id,
      role: (m.role === "assistant" || m.role === "tool" ? m.role : "user") as
        | "user"
        | "assistant"
        | "tool",
      content: m.content,
      ts: m.ts,
    }));
    return {
      state: "session_active",
      context: {
        ...context,
        session_id: payload.session_id ?? null,
        transcript,
        resource: {
          type: payload.resource_type ?? null,
          id: payload.resource_id ?? null,
        },
        session_dataset_unavailable: Boolean(payload.dataset_unavailable),
        pending_resume_session_id: null,
        underlying_cause_tag: payload.dataset_unavailable
          ? "dataset_not_found"
          : null,
      },
    };
  },

  session_dataset_unavailable: (state, context, _event) => ({
    state,
    context: {
      ...context,
      session_dataset_unavailable: true,
      resource: { type: null, id: null },
      underlying_cause_tag: "dataset_not_found",
    },
  }),

  // Silent return per US-205 Example 4 — used by the resumeSession actor
  // when the session row 404s.
  session_resume_not_found: (_state, context, _event) => ({
    state: "session_list_loaded",
    context: {
      ...context,
      session_id: null,
      transcript: [],
      resource: { type: null, id: null },
      pending_resume_session_id: null,
      // Silent — no underlying_cause_tag.
      underlying_cause_tag: null,
    },
  }),

  session_chat_recoverable_error: (_state, context, event) => {
    const payload = event.payload as {
      underlying_cause_tag?: string;
      pending_first_message?: string;
    };
    return {
      state: "error_recoverable",
      context: {
        ...context,
        underlying_cause_tag:
          payload.underlying_cause_tag ?? "transient",
        pending_first_message:
          payload.pending_first_message ?? context.pending_first_message,
      },
    };
  },

  // ────────────── session-chat MR-3 (US-206) new-session lifecycle ──────────
  // session_welcome_displayed: the machine entered `session_welcome`.
  // session_id is null; no backend session row exists yet (DWD-10 lazy-create).
  // pending_first_message in the payload preserves composer text when the
  // welcome state is re-entered via `retry_clicked` (app-arch §6.4 — machine
  // retains the composer across error_recoverable → retry).
  session_welcome_displayed: (_state, context, event) => {
    const payload = event.payload as { pending_first_message?: string };
    return {
      state: "session_welcome",
      context: {
        ...context,
        session_id: null,
        transcript: [],
        resource: { type: null, id: null },
        session_dataset_unavailable: false,
        pending_first_message: payload.pending_first_message ?? "",
        underlying_cause_tag: null,
      },
    };
  },

  // session_active_reached: terminal-for-now event emitted after the
  // `createSessionEagerly` invoke settles. Distinct from `session_resumed`
  // because the eager-create path has no transcript fetch and no
  // active_dataset_id probe — it's a brand new row.
  session_active_reached: (_state, context, event) => {
    const payload = event.payload as { session_id?: string };
    return {
      state: "session_active",
      context: {
        ...context,
        session_id: payload.session_id ?? null,
        transcript: [],
        resource: { type: null, id: null },
        session_dataset_unavailable: false,
        pending_first_message: "",
        underlying_cause_tag: null,
      },
    };
  },

  // ────────────── session-chat MR-5 (US-209) dataset switching ──────────
  // Per app-arch §466 + DESIGN §2B the session-chat machine owns the
  // `switching_dataset_context` state. The orchestrator emits these three
  // events from the `switchDatasetContext` settle path (mirroring the
  // D-MR4-06 switching_project emission discipline).

  // The machine entered `switching_dataset_context` (the
  // `switchDatasetContext` invoke is in flight). Unlike
  // `switching_project_started`, this does NOT invalidate `resource` —
  // IC-J002-5 requires EXACTLY ONE resource_* update, applied atomically
  // on settle (`dataset_attached`). The prior dataset stays visible while
  // the new pick is validated.
  switching_dataset_context_started: (_state, context, _event) => ({
    state: "switching_dataset_context",
    context: { ...context },
  }),

  // Validated + persisted: retarget `context.resource` to the picked
  // dataset (the single resource_* update — IC-J002-5). Clears any prior
  // dataset_not_found / dataset_access_denied banner.
  dataset_attached: (_state, context, event) => {
    const payload = event.payload as {
      resource_type?: ResourceType | null;
      resource_id?: string | null;
    };
    return {
      state: "session_active",
      context: {
        ...context,
        resource: {
          type: payload.resource_type ?? null,
          id: payload.resource_id ?? null,
        },
        session_dataset_unavailable: false,
        underlying_cause_tag: null,
      },
    };
  },

  // ScopeResolver invariant 4 rejection (US-209 Example 3/4): the prior
  // `context.resource` is left UNCHANGED — the previously-attached dataset
  // stays in scope; only the named cause surfaces for the FE gutter copy
  // ("you don't have access to that dataset"). session.active_dataset_id
  // was NOT written.
  dataset_access_denied: (_state, context, _event) => ({
    state: "session_active",
    context: {
      ...context,
      underlying_cause_tag: "dataset_access_denied",
    },
  }),

  // ──────────── MR-6 / US-210 cross-machine FREEZE/THAW ────────────
  // Per app-arch §2.3 the freeze lifecycle is per-machine; the
  // orchestrator's broadcastFreeze/broadcastThaw emission arms append
  // these (machines never write FlowEvents — ADR-028/ADR-030). `*_frozen`
  // records `last_live_state` so `*_thawed` can restore it. All other
  // context is preserved untouched — the FE renders the "Refreshing your
  // session..." banner OVER the prior paint, so the welcome chips / scope
  // / transcript stay visible with no flicker (US-210 Example 5).

  project_context_frozen: (_state, context, event) => ({
    state: "freeze",
    context: {
      ...context,
      last_live_state:
        (event.payload.last_live_state as string | undefined) ?? null,
    },
  }),

  session_chat_frozen: (_state, context, event) => ({
    state: "freeze",
    context: {
      ...context,
      last_live_state:
        (event.payload.last_live_state as string | undefined) ?? null,
    },
  }),

  // THAW restores the state the machine froze from. When that state was
  // an invoke-driven transient, a terminal event (session_resumed /
  // project_switched / …) emitted immediately after by the same
  // broadcastThaw arm advances it further; this handler is the baseline
  // restore so a non-transient freeze (e.g. session_welcome — US-210
  // Example 5) returns with no flicker and no extra event.
  project_context_thawed: (_state, context, _event) => ({
    state: context.last_live_state ?? "resolving_initial_scope",
    context: { ...context },
  }),

  session_chat_thawed: (_state, context, _event) => ({
    state: context.last_live_state ?? "loading_session_list",
    context: { ...context },
  }),

  // DWD-7 — observability only, no state change, no UX surface. The
  // cumulative counter + last_stale_intent feed
  // `harness.j002.assert_stale_intent_dropped` / the
  // `assert_no_stale_intents_dropped` happy-path assertion.
  stale_intent_dropped_after_thaw: (state, context, event) => ({
    state,
    context: {
      ...context,
      stale_intents_dropped_count: context.stale_intents_dropped_count + 1,
      last_stale_intent: {
        intent_type: (event.payload.intent_type as string | undefined) ?? "",
        target_id: (event.payload.target_id as string | undefined) ?? "",
      },
    },
  }),

  // The 5s replay-buffer timeout / silent-reauth-failure path (US-210
  // Example 3 / scenario 4). The subsequent `*_recoverable_error` event
  // (emitted right after by the same broadcastThaw arm) sets the
  // user-facing error_recoverable; this handler moves state out of
  // `freeze` and tags the cause so a lone `replay_abandoned` is still
  // coherent. `last_live_state` is preserved for the retry history target.
  replay_abandoned: (_state, context, _event) => ({
    state: "error_recoverable",
    context: {
      ...context,
      underlying_cause_tag: "replay_abandoned",
    },
  }),
};

/**
 * Apply a single event to the running (state, context). Looks up the
 * event.type in EVENT_HANDLERS; unknown types are a no-op (the reducer
 * stays total without crashing on events introduced by later steps).
 *
 * Pure. Called by `buildProjection` in the replay loop.
 */
function applyEvent(
  state: string,
  context: ReducedContext,
  event: FlowEvent,
): { state: string; context: ReducedContext } {
  const handler = EVENT_HANDLERS[event.type];
  return handler ? handler(state, context, event) : { state, context };
}

export function buildProjection(
  flow_id: string,
  events: FlowEvent[],
  _snapshot?: FlowProjection,
): FlowProjection {
  let state = "anonymous";
  let context = initialContext();
  let lastEventAt = "";
  let correlationId = "";

  for (const event of events) {
    const next = applyEvent(state, context, event);
    state = next.state;
    context = next.context;
    lastEventAt = event.ts;
    correlationId = event.correlation_id;
  }

  // Build the projection-level active_scope from the running context.
  // Precedence:
  //   1. resolved_scope (from deep_link_opened)
  //   2. context.project (set by project_selected on project-context flows
  //      or project_context_inherited on session-chat flows — same shape per
  //      audit §9 Q3 collapse, see projection-property.test.ts). Carries
  //      `resource_*` from session_resumed when session-chat has settled;
  //      `resource` stays { type: null, id: null } on project-context flows.
  //   3. org-only
  //   4. empty
  let scope: ActiveScope = EMPTY_SCOPE;
  if (context.resolved_scope) {
    scope = context.resolved_scope;
  } else if (context.project.id && context.org.id) {
    scope = {
      org_id: context.org.id,
      project_id: context.project.id,
      resource_type: context.resource.type,
      resource_id: context.resource.id,
    };
  } else if (context.org.id) {
    scope = {
      org_id: context.org.id,
      project_id: null,
      resource_type: null,
      resource_id: null,
    };
  }

  return {
    flow_id,
    state,
    context: context as unknown as Record<string, unknown>,
    active_scope: scope,
    sequence_id: events.length,
    last_event_at: lastEventAt,
    correlation_id: correlationId,
  };
}

// Re-export ResourceType so callers don't need a separate import path.
export type { ResourceType };
