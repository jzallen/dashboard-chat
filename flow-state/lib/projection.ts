// buildProjection — pure fold from FlowEvent[] into the public projection
// shape declared by `design/handoff-design-to-distill.md` §4.
//
// The TS acceptance harness reads this shape; the FE renders from this shape;
// the acceptance tests assert against this shape. Single source of truth.
//
// Design choice: the projection is built by replaying events through a tiny
// reducer rather than by snapshotting the XState machine. This keeps the
// projection a PURE function (testable without an XState runtime) and gives
// the orchestrator + persistence layer a clear contract: events go in, the
// projection is the public read shape.

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
   * Populated by deep_link_opened / scope_reconciled events.
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
  };
}

/**
 * Reduce a single event into (state, context). Pure.
 *
 * Step 01-01 covers anonymous → authenticating → authenticated_no_org.
 * Subsequent steps extend the reducer with creating_org / ready / error
 * branches per the J-001 state chart.
 */
function reduce(
  state: string,
  context: ReducedContext,
  event: FlowEvent,
): { state: string; context: ReducedContext } {
  if (event.type === "sign_in_clicked") {
    return { state: "authenticating", context };
  }

  if (event.type === "auth_callback_resolved") {
    const userPayload =
      (event.payload.user as Partial<ReducedContext["user"]>) ?? {};
    const next: ReducedContext = {
      ...context,
      user: {
        email: userPayload.email ?? null,
        display_name: userPayload.display_name ?? null,
      },
    };
    return { state: "authenticated_no_org", context: next };
  }

  if (event.type === "auth_failed") {
    const cause =
      (event.payload.underlying_cause_tag as string | undefined) ?? null;
    return {
      state: "error_recoverable",
      context: { ...context, underlying_cause_tag: cause },
    };
  }

  if (event.type === "org_form_submitted") {
    // Submission enters creating_org transiently; the projection observed
    // after settle reflects the terminal state (ready / authenticated_no_org
    // / error_recoverable). Until that next event lands, the reducer shows
    // creating_org so a concurrent reader can see the "Creating..." state.
    return {
      state: "creating_org",
      context: { ...context, org_validation_error: null },
    };
  }

  if (event.type === "validation_failed") {
    const err =
      (event.payload.error as ReducedContext["org_validation_error"]) ?? null;
    return {
      state: "authenticated_no_org",
      context: { ...context, org_validation_error: err },
    };
  }

  if (event.type === "org_created_and_jwt_reissued") {
    const orgPayload =
      (event.payload.org as Partial<ReducedContext["org"]>) ?? {};
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
      },
    };
  }

  if (event.type === "reissue_failed_partial") {
    const cause =
      (event.payload.underlying_cause_tag as string | undefined) ?? "partial-setup";
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
  }

  if (event.type === "deep_link_opened") {
    // Payload shape (mirrors `open_deep_link` handler in `index.ts`):
    //   { scope: ActiveScope, project: { id, name } | null, reconciled: bool }
    const payload = event.payload as {
      scope?: ActiveScope;
      project?: { id: string | null; name: string | null } | null;
      reconciled?: boolean;
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
      },
    };
  }

  if (event.type === "scope_reconciled") {
    // Defensive: a separate scope_reconciled event (vs. embedded in
    // deep_link_opened.reconciled) may be appended by future flows. Both
    // shapes land at the same projection field.
    return {
      state,
      context: { ...context, scope_reconciled: true },
    };
  }

  if (event.type === "scope_access_denied") {
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
  }

  // Unknown event: no-op. Keeps the reducer total without crashing on
  // events introduced by later steps.
  return { state, context };
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
    const reduced = reduce(state, context, event);
    state = reduced.state;
    context = reduced.context;
    lastEventAt = event.ts;
    correlationId = event.correlation_id;
  }

  // Build the projection-level active_scope from the reduced context.
  // Precedence: resolved_scope (from deep_link_opened) > derived from org.
  let scope: ActiveScope = EMPTY_SCOPE;
  if (context.resolved_scope) {
    scope = context.resolved_scope;
  } else if (context.org.id) {
    // Once Maya has an org but hasn't opened a deep link, the scope is
    // org-only — project_id stays null per I2 (no project context yet).
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
