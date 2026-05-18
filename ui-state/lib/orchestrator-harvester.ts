// Harvester for actor-settled state used by the FlowOrchestrator.
//
// The LEAF-D ESLint rule `no-orchestrator-snapshot-reads` forbids
// `snapshot.context.*` / `snapshot.getContext()` reads in
// `ui-state/lib/orchestrator.ts` (ADR-030 §"Decision outcome" — the
// projection is the SSOT for read state in the emission paths). But
// SOME fields are set on the actor AFTER its settled state and BEFORE
// any FlowEvent has captured them, so the orchestrator's emission code
// needs a one-shot harvest from the snapshot to put the data into the
// terminal event's payload (the payload IS what the projection reducer
// observes; without it, the projection would never see the field).
//
// This file is the designated harvest boundary. The LEAF-D rule's
// `files:` glob does NOT include this file — the snapshot reads here
// are the controlled exception. All other reads in `orchestrator.ts`
// route through the projection.
//
// When a future LEAF-C+-style refactor adds upstream actor-output events
// that feed the projection BEFORE the emission read (so the projection
// has the field on its own and the harvester is no longer needed),
// callers can be migrated one at a time and the harvest functions
// retired. Track the migration in TaskList / ADR-030 §"Migration
// sequencing".

import type { AnyActorRef } from "xstate";

/**
 * Login-and-org-setup machine's settled-state harvest.
 *
 * Reads `org`, `user`, and `underlying_cause_tag` from the actor's
 * current snapshot context. Used by `orchestrator.ts` `send()` to source
 * the terminal-event payload for:
 *   - `ready` → `org_created_and_jwt_reissued` (needs `org.id` to mint
 *     the access_token, and `org` / `user` to populate the event payload)
 *   - `error_recoverable` → `reissue_failed_partial` (needs
 *     `underlying_cause_tag` and `org` for the payload)
 *
 * The fields harvested here are exactly those the LEAF-B commit body
 * flagged as "carrying placeholder values" when read from the projection
 * directly — the projection reducer for the terminal event populates
 * them, so reads from projection at the moment of emission see null.
 */
export function harvestSettledLoginState(actor: AnyActorRef): {
  org: { id: string | null; name: string | null };
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  underlying_cause_tag: string | null;
} {
  const ctx = actor.getSnapshot().context as {
    org: { id: string | null; name: string | null };
    user: {
      email: string | null;
      display_name: string | null;
      first_name: string | null;
    };
    underlying_cause_tag: string | null;
  };
  return {
    org: ctx.org,
    user: ctx.user,
    underlying_cause_tag: ctx.underlying_cause_tag,
  };
}

/**
 * Project-context machine's settled-state harvest (D-MR4-06).
 *
 * The `switchProject` actor's resolved `project` (and the
 * `access_revoked` / `project_not_found` / `transient` cause it sets on
 * the error branches) lands on the machine's context AFTER the snapshot
 * value flips to its settled state and BEFORE any FlowEvent has captured
 * it. The projection therefore reads `project: { id: null, name: null }`
 * / `underlying_cause_tag: null` at the moment of emission — exactly the
 * LEAF-B trade-off the `beginIfNotStarted` comment block flagged as
 * "currently live only in the machine's settled context ... until
 * LEAF-C+ work". This is that harvest: it is the project-context
 * counterpart of `harvestSettledLoginState`, used by `orchestrator.ts`
 * `send()` to source the `project_selected` / `project_switched` /
 * `scope_mismatch_displayed` terminal-event payloads on the
 * `switching_project_intent` settle path so the projection — the SSOT
 * the acceptance probes read — reflects the switched project.
 */
export function harvestSettledProjectContextState(actor: AnyActorRef): {
  org_id: string | null;
  project: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  last_used_degraded_project_ids: string[];
  most_recent_session_per_project: Record<string, string>;
  pending_project_name: string;
  project_validation_error: { kind: string; message: string } | null;
} {
  const ctx = actor.getSnapshot().context as {
    org_id: string | null;
    project: { id: string | null; name: string | null };
    underlying_cause_tag: string | null;
    last_used_degraded_project_ids?: string[];
    most_recent_session_per_project?: Record<string, string>;
    pending_project_name?: string;
    project_validation_error?: { kind: string; message: string } | null;
  };
  return {
    // MR-1 create-path + OQ-J002-5 (RC-1 / step-5): the create-project
    // sub-flow's terminal values land on the machine context AFTER the
    // snapshot flips and BEFORE the first FlowEvent captures them — the
    // SAME D-MR4-06 / D-MR5-01 emission-completeness failure class the
    // switch / begin paths already harvest for:
    //   - `most_recent_session_per_project` — `resolveInitialScope` onDone
    //     assign (US-202 last-used resolution; observed `keys=[]`).
    //   - `pending_project_name` — `capturePendingProjectName` on the
    //     `create_project_submitted` guard arm (preserved across
    //     `creating_project ↔ error_recoverable`; transient-retry AC).
    //   - `project_validation_error` — `recordProjectValidationError` on
    //     the empty/invalid-name arm (US-201 inline-error AC).
    most_recent_session_per_project:
      ctx.most_recent_session_per_project ?? {},
    pending_project_name: ctx.pending_project_name ?? "",
    project_validation_error: ctx.project_validation_error ?? null,
    // OQ-J002-5 degraded path (RC-1): `resolveInitialScope`'s onDone assign
    // writes `last_used_degraded_project_ids` onto the machine context AFTER
    // the snapshot flips to `project_selected` and BEFORE the first
    // FlowEvent captures it — the SAME D-MR4-06 / D-MR5-01 emission-
    // completeness failure class. The begin path's
    // `last_used_resolution_degraded` emission therefore read an empty list
    // from the projection-of-log (US-202 degraded scenario observed
    // `last_used_resolution_degraded: null`). Harvest the settled set here.
    last_used_degraded_project_ids: ctx.last_used_degraded_project_ids ?? [],
    // D-MR5-01: the begin path needs `org_id` too — it lands on the
    // project-context machine context (from the `auth_ready` event /
    // spawn input) and, like `project`, is absent from the
    // projection-of-log at first-write emission time. The switch-settle
    // callers (D-MR4-06) ignore this extra field (same-org switch).
    org_id: ctx.org_id ?? null,
    project: ctx.project,
    underlying_cause_tag: ctx.underlying_cause_tag,
  };
}

/**
 * Session-chat machine's settled-state harvest (US-209 / MR-5).
 *
 * The exact analog of `harvestSettledProjectContextState` for the
 * `switching_dataset_context` settle path: the `switchDatasetContext`
 * actor's resolved `resource` (and the `dataset_access_denied` /
 * `transient` cause on its branches) lands on the machine context AFTER
 * the snapshot value flips back to `session_active` and BEFORE any
 * FlowEvent has captured it — so a projection read at emission time would
 * see the PRIOR-tick `resource` (the D-MR4-06 failure class). Used by
 * `orchestrator.ts` `send()` to source the `dataset_attached` /
 * `dataset_access_denied` terminal-event payloads so the projection — the
 * SSOT the US-209 acceptance probes read — reflects the switched dataset.
 */
export function harvestSettledSessionChatState(actor: AnyActorRef): {
  session_id: string | null;
  transcript: Array<{ id: string; role: string; content: string; ts: string }>;
  resource: { type: string | null; id: string | null };
  underlying_cause_tag: string | null;
  session_list: Array<{
    id: string;
    title: string | null;
    last_active_at: string;
    active_dataset_id: string | null;
  }>;
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;
  pending_first_message: string;
} {
  const ctx = actor.getSnapshot().context as {
    session_id: string | null;
    transcript: Array<{
      id: string;
      role: string;
      content: string;
      ts: string;
    }>;
    resource: { type: string | null; id: string | null };
    underlying_cause_tag: string | null;
    session_list: Array<{
      id: string;
      title: string | null;
      last_active_at: string;
      active_dataset_id: string | null;
    }>;
    session_list_next_cursor: string | null;
    session_list_has_more: boolean;
    pending_first_message: string;
  };
  return {
    // D-MR5-01: session_id + transcript are materialized atomically with
    // `resource` by the `resumeSession` onDone assign — all land on the
    // machine context after the snapshot flips, so the projection-of-log
    // read at emission time sees them null/empty (the IC-J002-3 atomic
    // materialization is correct in the machine; the regression was that
    // the emission never observed it).
    session_id: ctx.session_id,
    transcript: ctx.transcript,
    resource: ctx.resource,
    underlying_cause_tag: ctx.underlying_cause_tag,
    // RC-2 (J-002 mr_2/mr_3): the `loadSessionList` onDone assign
    // materializes session_list / next_cursor / has_more onto the machine
    // context AFTER the snapshot flips to `session_list_loaded` and BEFORE
    // any FlowEvent captures it — the SAME D-MR4-06 / D-MR5-01 emission-
    // completeness failure class. On the spawn path
    // (project_ready → loading_session_list → session_list_loaded) the
    // orchestrator emitted `session_list_loaded` from a projection-of-log
    // read that still saw the empty prior-tick list, so every mr_2/mr_3
    // precondition (`_wait_for_session_chat_state(session_list_loaded)`
    // then asserting list contents) observed an empty list. Harvest the
    // settled list here so the emission reflects the loaded sessions.
    session_list: ctx.session_list,
    session_list_next_cursor: ctx.session_list_next_cursor,
    session_list_has_more: ctx.session_list_has_more,
    // RC-2 (US-206): the eager-create `session_id` (createSessionEagerly
    // onDone) and the composer text `pending_first_message`
    // (capturePendingFirstMessage, preserved across the transient-failure
    // retry) both land on the machine context AFTER the snapshot flips
    // (to `session_active` / `error_recoverable`) and BEFORE any FlowEvent
    // captures them. The `session_active_reached`, `session_welcome`, and
    // `error_recoverable` emission branches read the projection-of-log,
    // which still shows the empty prior-tick values — so US-206's
    // eager-create id and composer-preservation assertions fail. Harvest
    // them here so the emission reflects the settled context.
    pending_first_message: ctx.pending_first_message,
  };
}

/**
 * Cross-machine FREEZE/THAW settled-state harvest (US-210 / MR-6).
 *
 * Both J-002 machines (project-context + session-chat) declare a
 * top-level `on.FREEZE` whose action assigns `last_live_state` from the
 * snapshot, a `recordStale*` action that bumps
 * `stale_intents_dropped_count` + `last_stale_intent`, and a
 * `replay_abandoned` arm that sets `underlying_cause_tag`. All four land
 * on the machine context AFTER the snapshot value flips (to `freeze`, or
 * back to `last_live_state`, or to `error_recoverable`) and BEFORE any
 * FlowEvent has captured them — the exact D-MR4-06 / D-MR5-01 emission-
 * completeness failure class the ADR-030 2026-05-16 tripwire amendment
 * names. The orchestrator's broadcastFreeze / broadcastThaw emission arms
 * source the `*_frozen` / `*_thawed` / `stale_intent_dropped_after_thaw`
 * / `replay_abandoned` FlowEvent payloads from here so the projection —
 * the SSOT the US-210 acceptance probes + TS harness read — reflects the
 * freeze lifecycle instead of going stale at the pre-freeze state.
 */
export function harvestSettledFreezeState(actor: AnyActorRef): {
  correlation_id: string;
  last_live_state: string | null;
  stale_intents_dropped_count: number;
  last_stale_intent: { intent_type: string; target_id: string } | null;
  underlying_cause_tag: string | null;
  /** US-210 AC — the originating user-action, preserved in the freeze /
   *  replay_abandoned FlowEvent payload "for re-issue". These live on the
   *  machine context (set by capturePendingResumeIntent /
   *  capturePendingFirstMessage / capturePendingProjectName) and are
   *  absent from the projection-of-log at freeze time (only their
   *  *_started events would have written them, which never fired when
   *  FREEZE pre-empted the in-flight invoke). Per-machine fields —
   *  undefined for the machine that doesn't have them. */
  pending_resume_session_id: string | null;
  pending_first_message: string | null;
  pending_project_name: string | null;
} {
  const ctx = actor.getSnapshot().context as {
    correlation_id: string;
    last_live_state: string | null;
    stale_intents_dropped_count: number;
    last_stale_intent: { intent_type: string; target_id: string } | null;
    underlying_cause_tag: string | null;
    pending_resume_session_id?: string | null;
    pending_first_message?: string | null;
    pending_project_name?: string | null;
  };
  return {
    pending_resume_session_id: ctx.pending_resume_session_id ?? null,
    pending_first_message: ctx.pending_first_message ?? null,
    pending_project_name: ctx.pending_project_name ?? null,
    // US-210: the original correlation reference is preserved across the
    // whole freeze→thaw lifecycle (it lives on the machine context, set
    // at spawn / project_ready and never rewritten by FREEZE/THAW).
    correlation_id: ctx.correlation_id ?? "",
    last_live_state: ctx.last_live_state ?? null,
    stale_intents_dropped_count: ctx.stale_intents_dropped_count ?? 0,
    last_stale_intent: ctx.last_stale_intent ?? null,
    underlying_cause_tag: ctx.underlying_cause_tag ?? null,
  };
}
