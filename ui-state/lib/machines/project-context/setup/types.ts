// Domain types for the project-context statechart: the machine's
// context / event / state / summary / cause-tag / input shapes, plus the
// typed-arg aliases the guards (./guards.ts) and actions (./actions.ts) annotate
// their params with. Named-action and named-guard definitions must spell their
// arg type out (only inline definitions get it inferred), so they all share
// `ActionArgs`/`GuardArgs` from here.
//
// Imports are type-only and one-way: types.ts → domain.ts (for
// ProjectValidationError) and types.ts → ../../../domain/active-scope.ts (for the
// ResourceType wire literal the open_deep_link payload carries). Nothing here
// imports machine.ts, so there is no machine ↔ types cycle.
//
// References:
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-030-*.md  — flow_id key form / branch-relevant data flow

import type { ResourceType } from "../../../domain/active-scope.ts";
import type { ProjectValidationError } from "./domain.ts";

export type ProjectContextState =
  | "awaiting_scope_report"
  | "no_projects"
  | "project_selected"
  | "switching_project"
  | "scope_mismatch_terminal"
  | "error_recoverable";

export interface ProjectSummary {
  id: string;
  name: string;
}

/** The wire cause carried on a `project_create_failed` report. The default
 *  Phase-D POST is retryable; the single cause literal keeps the report shape
 *  uniform (ADR-049 §3.3 — error states accept outcome reports directly). */
export type ProjectCreateFailureCause = "project_create_failed";

export type ProjectContextCauseTag =
  | "no_projects"
  | "transient"
  | "project_not_found"
  | "cross_tenant"
  | "access_revoked"
  | "project_create_failed";

export interface ProjectContextMachineContext {
  request_id: string;
  principal_id: string;

  // From J-001 projection — set on auth_ready event entry:
  org_id: string;
  user: { first_name: string | null };

  // Authoritative project context — populated on project_selected entry:
  project: { id: string | null; name: string | null };

  // Deep-link wish payloads — populated on open_deep_link; cleared on settle.
  // These fields are URL-level user wishes that have not yet been confirmed or
  // denied. They carry the shape the user requested from the URL through
  // resolution; on settle (project_selected) the orchestrator forwards
  // `deeplink_session_id` to session-chat via the `project_ready` payload.
  //
  // `intent_resource_id` + `intent_resource_type` are not stored here:
  // project-context never reads them — they are pure pass-through. The
  // orchestrator forwards them from the `open_deep_link` event payload directly
  // into `project_ready`, never touching this machine's ctx.
  deeplink_project_id: string | null;
  deeplink_session_id: string | null;

  // Cross-state plumbing:
  underlying_cause_tag: ProjectContextCauseTag | null;
  retries_count: number;
  /** Composer text preserved across creating_project ↔ error_recoverable. */
  pending_project_name: string;

  // Inline validation error attached when a submitted project name fails
  // local validation (parallels J-001's org_validation_error).
  project_validation_error: ProjectValidationError | null;

  // Observability counters:
  scope_reconciled_count: number;
  stale_intents_dropped_count: number;
  // US-210 — the most recent stale-dropped intent; harvested by the
  // orchestrator to emit stale_intent_dropped_after_thaw (machines never write
  // FlowEvents).
  last_stale_intent: { intent_type: string; target_id: string } | null;

  // Per OQ-J002-5: per-project last_active_at map captured by resolveInitialScope.
  most_recent_session_per_project: Record<string, string>;

  // Last-used resolution degraded set (OQ-J002-5). Populated on
  // resolving_initial_scope's onDone when one or more `list_sessions` calls
  // 5xx-failed. The orchestrator reads this on settle to emit a
  // `last_used_resolution_degraded` event with `partial_result: true`.
  last_used_degraded_project_ids: string[];
}

export type ProjectContextEvent =
  | { type: "auth_ready"; org_id: string; user: { first_name: string } }
  // Client-reported scope outcomes (ADR-049 §3 / ADR-050 §f). The client
  // probes the backend (GET /api/projects) and REPORTS the resolution:
  //   - scope_resolved  — an existing project was picked (carries {id,name}).
  //   - project_created — the (auto / explicit) default project was created
  //     and is reported (carries {id,name}); Phase D's settle trigger.
  //   - no_projects_found — the backend has no project yet (carries {}).
  // The project-bearing reports land their {id,name} on context.project.
  | { type: "scope_resolved"; project: ProjectSummary }
  | { type: "project_created"; project: ProjectSummary }
  | { type: "no_projects_found" }
  | { type: "back_to_projects_clicked" }
  // Phase-D project-creation failure report (ADR-049 §3.3 / Spec 7b). The POST
  // failed (or its response was lost); the client reports it, the machine lands
  // in the report-accepting `error_recoverable` state. The client then re-POSTs
  // / re-probes and reports `project_created` / `scope_resolved` to converge —
  // there is no `retry_clicked` re-invoke (retired this slice).
  | { type: "project_create_failed"; cause: ProjectCreateFailureCause }
  // The `open_deep_link` event payload keys use the `intent_*` prefix — that's
  // the wire surface (FE + orchestrator). The values land in `deeplink_*`
  // context fields here.
  | {
      type: "open_deep_link";
      intent_project_id?: string;
      intent_session_id?: string;
      intent_resource_id?: string;
      intent_resource_type?: ResourceType;
    }
  // Atomic project switching. Fired by a loader (mid-session
  // deep-link to a different project) OR by the chat-view's
  // project-picker. The machine invokes `switchProject` which validates
  // the target via the backend's `GET /api/projects/:id`; the IC-J002-4
  // invalidation contract (session_id + resource_* cleared BEFORE the
  // new project's loading_session_list fires) is enforced at the
  // projection layer via the `switching_project_started` event handler.
  | { type: "switching_project_intent"; new_project_id: string };

/** The raw machine input (the begin envelope the context factory normalizes into
 *  context). Mirrors `setup({ types: { input } })`. */
export interface ProjectContextInput {
  request_id: string;
  principal_id: string;
  org_id?: string;
  user?: { first_name?: string };
  deeplink_project_id?: string;
}

/**
 * Shared typed-arg shape for the extracted guards + actions. `setup()` infers
 * this `{ context, event }` for inline definitions; the extracted predicates and
 * assigners annotate their single param with it. `event` is the declared event
 * union — done/error events from invoked actors are NOT members, which is why
 * the actor-result readers (assignResolvedScope, isCrossTenant, …) cast `event`
 * to read `.output`, exactly as they did when inline.
 */
export interface ActionArgs {
  context: ProjectContextMachineContext;
  event: ProjectContextEvent;
}
export type GuardArgs = ActionArgs;
