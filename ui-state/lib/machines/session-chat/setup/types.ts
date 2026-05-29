// Domain types for the session-chat statechart: the machine's
// context / event / state / summary / transcript / cause-tag / input shapes,
// plus the typed-arg aliases the guards (./guards.ts) and actions (./actions.ts)
// annotate their params with. Named-action and named-guard definitions must
// spell their arg type out (only inline definitions get it inferred), so they
// all share `ActionArgs`/`GuardArgs` from here.
//
// Imports are type-only and one-way: types.ts → ../../../domain/active-scope.ts
// (for the ResourceType wire literal the resource fields carry). Nothing here
// imports machine.ts, so there is no machine ↔ types cycle.
//
// References:
//   docs/decisions/adr-028-*.md  — machines own transitions; parent-ignorant children
//   docs/decisions/adr-030-*.md  — flow_id key form / branch-relevant data flow

import type { ResourceType } from "../../../domain/active-scope.ts";

// Re-export so the setup modules (actions.ts / guards.ts) name the resource
// wire literal from one place without each reaching into ../../../domain.
export type { ResourceType };

export type SessionChatState =
  | "waiting_for_project"
  | "loading_session_list"
  | "session_list_loaded"
  | "resuming_session"
  | "session_welcome"
  | "creating_session"
  | "session_active"
  | "switching_dataset_context"
  | "error_recoverable";

export interface SessionSummary {
  id: string;
  title: string | null;
  last_active_at: string;
  active_dataset_id: string | null;
}

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  ts: string;
}

export type SessionChatCauseTag =
  | "transient"
  | "list_sessions_degraded"
  | "session_not_found"
  | "dataset_not_found"
  | "dataset_access_denied";

export interface SessionChatMachineContext {
  request_id: string;
  principal_id: string;

  // Received via `project_ready` orchestrator broadcast — populated on entry
  // out of `waiting_for_project`:
  org_id: string;
  project: { id: string | null; name: string | null };

  // Session list state — populated on session_list_loaded entry:
  session_list: SessionSummary[];
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;

  // Active session — populated on session_active entry:
  session_id: string | null;
  transcript: TranscriptMessage[];

  // Active resource (dataset) — populated on session_active entry from
  // `session.active_dataset_id`; also on switching_dataset_context exit:
  resource: { type: ResourceType | null; id: string | null };

  // The dataset pick captured from a `dataset_resolved_by_agent` /
  // `dataset_picked_directly` event in `session_active`, carried into the
  // `switching_dataset_context` invoke's input (US-209). XState invoke
  // `input` reads ctx, not the triggering event, so the pick MUST be
  // captured here on the transition. Cleared on settle (success OR
  // dataset_access_denied) so a stale pick can't bleed into a later
  // switch.
  intended_resource_id: string | null;
  intended_resource_type: ResourceType | null;

  // Pending session-resume target — populated EITHER by the inbound
  // `project_ready` payload's `deeplink_session_id` key (URL-level wish
  // forwarded by project-context) OR by a `session_clicked` event
  // (capturePendingResumeIntent action). Both paths feed the same downstream
  // consumer: the `loading_session_list → resuming_session` branch reads the
  // actor output's `resume_target` (which echoes
  // `input.pending_resume_session_id`) and the `resuming_session.invoke.input`
  // reads ctx directly for the session id to resume. Cleared by the resume
  // actor's onDone.
  //
  // `intent_resource_id` / `intent_resource_type` are not captured here — the
  // dataset-switching events carry the resource id/type directly in their
  // payload (see SessionChatEvent's `dataset_resolved_by_agent` and
  // `dataset_picked_directly` variants). The orchestrator forwards them
  // directly from the `open_deep_link` event payload into the `project_ready`
  // broadcast; the session-chat input/event surface accepts them as no-op
  // slots.
  pending_resume_session_id: string | null;

  // Cross-state plumbing:
  underlying_cause_tag: SessionChatCauseTag | null;
  last_live_state: SessionChatState | null;
  retries_count: number;
  /** Composer text preserved across session_welcome ↔ error_recoverable. */
  pending_first_message: string;

  // Observability counters:
  stale_intents_dropped_count: number;
  // The most recent stale intent the DWD-7 guard dropped after THAW.
  // The orchestrator harvests this on the replay-settle path to emit the
  // `stale_intent_dropped_after_thaw` FlowEvent (the projection/harness
  // SSOT — machines never write FlowEvents).
  last_stale_intent: { intent_type: string; target_id: string } | null;
}

export type SessionChatEvent =
  // External (FE-emitted):
  | { type: "session_clicked"; session_id: string }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; content: string }
  | { type: "refresh_session_list" }
  | { type: "dataset_resolved_by_agent"; resource_id: string; resource_type: ResourceType }
  | { type: "dataset_picked_directly"; resource_id: string; resource_type: ResourceType }
  | { type: "retry_clicked" }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" }
  // Cross-machine (orchestrator-emitted; never FE-emitted):
  | {
      type: "project_ready";
      org_id: string;
      project_id: string;
      project_name: string;
      request_id: string;
      // The URL-level deep-link session wish. Captured into
      // pending_resume_session_id on entry.
      deeplink_session_id?: string | null;
      // Accepted but not stored on ctx — the orchestrator routes them
      // through the wire/projection directly. Kept on the event surface.
      intent_resource_id?: string | null;
      intent_resource_type?: ResourceType | null;
    };

/** The raw machine input (the begin envelope the context factory normalizes into
 *  context). Mirrors `setup({ types: { input } })`. */
export interface SessionChatInput {
  request_id: string;
  principal_id: string;
  org_id?: string;
  project_id?: string;
  project_name?: string;
  // URL-level wish at spawn time — captured into pending_resume_session_id.
  // Distinct from the click-captured resume target.
  deeplink_session_id?: string | null;
  // Accepted but not stored on ctx.
  intent_resource_id?: string | null;
  intent_resource_type?: ResourceType | null;
}

/**
 * Shared typed-arg shape for the extracted guards + actions. `setup()` infers
 * this `{ context, event }` for inline definitions; the extracted predicates and
 * assigners annotate their single param with it. `event` is the declared event
 * union — done/error events from invoked actors are NOT members, which is why
 * the actor-result readers (assignResumedSession, hasResumeTarget, …) cast
 * `event` to read `.output`, exactly as they did when inline.
 */
export interface ActionArgs {
  context: SessionChatMachineContext;
  event: SessionChatEvent;
}
export type GuardArgs = ActionArgs;
