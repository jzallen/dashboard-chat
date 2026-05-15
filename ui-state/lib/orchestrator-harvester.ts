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
