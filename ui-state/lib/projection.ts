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
  user: { email: string | null; display_name: string | null };
  org: { id: string | null; name: string | null };
  /**
   * Per ADR-029, the projection's `context.project` carries the
   * authoritative (current) project name as known to the user's machine.
   * Populated by deep_link_opened / scope_reconciled / project_selected
   * / project_created events.
   */
  project: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  retries: number;
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
  user_first_name: string | null;
  pending_project_name: string;
  project_validation_error: { kind: string; message: string } | null;
  /** Per OQ-J002-5: per-project last_active_at map captured by
   *  resolveInitialScope. Empty when J-002 hasn't resolved yet. */
  most_recent_session_per_project: Record<string, string>;
  /** Per OQ-J002-5 degraded path: ids of projects whose list_sessions
   *  call 5xx-failed during last-used resolution. */
  last_used_resolution_degraded: { failed_project_ids: string[]; partial_result: boolean } | null;
  /** J-002 deep-link intent payload (US-204 / DWD-9). Carries the URL-level
   *  intent so future MR (session resume, dataset switching) can consume
   *  these fields. Cleared by back_to_projects_clicked. */
  intent_project_id: string | null;
  intent_session_id: string | null;
  intent_resource_id: string | null;
  intent_resource_type: ResourceType | null;
}

function initialContext(): ReducedContext {
  return {
    user: { email: null, display_name: null },
    org: { id: null, name: null },
    project: { id: null, name: null },
    underlying_cause_tag: null,
    retries: 0,
    org_validation_error: null,
    scope_reconciled: false,
    scope_resolution_error: null,
    resolved_scope: null,
    access_token: null,
    user_first_name: null,
    pending_project_name: "",
    project_validation_error: null,
    most_recent_session_per_project: {},
    last_used_resolution_degraded: null,
    intent_project_id: null,
    intent_session_id: null,
    intent_resource_id: null,
    intent_resource_type: null,
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
    return {
      state: "authenticated_no_org",
      context: {
        ...context,
        user: {
          email: userPayload.email ?? null,
          display_name: userPayload.display_name ?? null,
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

  // Payload shape (mirrors `open_deep_link` handler in `index.ts`):
  //   { scope: ActiveScope, project: { id, name } | null, reconciled: bool,
  //     intent_project_id?, intent_session_id?, intent_resource_id?,
  //     intent_resource_type? }
  //
  // Per DWD-9: the J-002 intent fields are carried in the same event payload
  // so future MR consumers (session resume, dataset switching) read them
  // from the projection's context.
  deep_link_opened: (state, context, event) => {
    const payload = event.payload as {
      scope?: ActiveScope;
      project?: { id: string | null; name: string | null } | null;
      reconciled?: boolean;
      intent_project_id?: string | null;
      intent_session_id?: string | null;
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
        intent_project_id:
          payload.intent_project_id ?? context.intent_project_id,
        intent_session_id:
          payload.intent_session_id ?? context.intent_session_id,
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

  j002_resolution_started: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      user_first_name?: string | null;
    };
    return {
      state: "resolving_initial_scope",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        user_first_name: payload.user_first_name ?? context.user_first_name,
      },
    };
  },

  no_projects_displayed: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      user_first_name?: string | null;
    };
    return {
      state: "no_projects_empty_state",
      context: {
        ...context,
        org: {
          id: payload.org_id ?? context.org.id,
          name: context.org.name,
        },
        user_first_name: payload.user_first_name ?? context.user_first_name,
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

  scope_mismatch_displayed: (_state, context, event) => {
    const payload = event.payload as {
      org_id?: string;
      underlying_cause_tag?: string;
      intent_project_id?: string | null;
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
        intent_project_id:
          payload.intent_project_id ?? context.intent_project_id,
      },
    };
  },

  j002_recoverable_error: (_state, context, event) => {
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
  // Precedence: resolved_scope (from deep_link_opened) > J-002 project
  // (derived from context.org.id + context.project) > org-only > empty.
  let scope: ActiveScope = EMPTY_SCOPE;
  if (context.resolved_scope) {
    scope = context.resolved_scope;
  } else if (context.org.id) {
    // J-002 project-selected derivation: when the projection's context
    // carries a project from a J-002 project_created/project_selected
    // event, surface it on active_scope so consumers (chat-view, agent's
    // X-Active-Scope header writer) read the project_id from the
    // projection envelope directly (DWD-4 + ADR-029 §1 I2 contract).
    scope = {
      org_id: context.org.id,
      project_id: context.project.id ?? null,
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
