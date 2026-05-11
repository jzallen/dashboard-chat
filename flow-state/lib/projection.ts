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

import type { ActiveScope } from "./active-scope.ts";

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
  underlying_cause_tag: string | null;
  retries: number;
}

function initialContext(): ReducedContext {
  return {
    user: { email: null, display_name: null },
    org: { id: null, name: null },
    underlying_cause_tag: null,
    retries: 0,
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

  return {
    flow_id,
    state,
    context: context as unknown as Record<string, unknown>,
    active_scope: EMPTY_SCOPE,
    sequence_id: events.length,
    last_event_at: lastEventAt,
    correlation_id: correlationId,
  };
}
