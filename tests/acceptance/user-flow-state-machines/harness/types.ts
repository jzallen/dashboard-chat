// Types that mirror the four-piece contract from
// `docs/feature/user-flow-state-machines/design/handoff-design-to-distill.md`.
//
// These re-declare (rather than import from) the flow-state/ scaffold types
// so the acceptance suite cannot accidentally couple to production internals.
// CM-A: tests never `from "flow-state/lib/..."` import.

export type ResourceType = "dataset" | "view" | "report";

export interface ActiveScope {
  org_id: string;
  project_id: string | null;
  resource_type: ResourceType | null;
  resource_id: string | null;
}

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

export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "partial-setup"
  | "workos-profile-corrupt"
  | "jwks_not_warm";
