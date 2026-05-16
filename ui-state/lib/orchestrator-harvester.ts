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
} {
  const ctx = actor.getSnapshot().context as {
    org_id: string | null;
    project: { id: string | null; name: string | null };
    underlying_cause_tag: string | null;
  };
  return {
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
  };
}
