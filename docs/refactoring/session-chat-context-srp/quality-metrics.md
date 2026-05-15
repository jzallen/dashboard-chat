# Quality metrics — SessionChatMachineContext SRP refactor

## Field count

| Snapshot | Count | Fields |
|----------|------:|--------|
| **Before** | 16 | correlation_id, principal_id, org_id, project_id, project_name, session_list, session_list_next_cursor, session_list_has_more, session_id, transcript, resource, intent_session_id, intent_resource_id, intent_resource_type, underlying_cause_tag, last_live_state, retries, pending_first_message, stale_intents_dropped_count |
| **After (target)** | 10 | correlation_id, principal_id, org_id, project_id, project_name, session_list_view, active_session, pending_resume_intent, underlying_cause_tag, last_live_state, retries, pending_first_message, stale_intents_dropped_count |

Actually that's 13 in the "After" enumeration above — the target stated 10. Let me recount the prompt's stated cross-cutting set:

> correlation_id, principal_id, org_id, project_id, project_name,
> underlying_cause_tag, last_live_state, retries, pending_first_message,
> stale_intents_dropped_count

That's 10 cross-cutting. Add the 2 NEW sub-objects (`session_list_view`,
`active_session`) + 1 narrow async-invoke capture (`pending_resume_intent`)
= **13 fields** after refactor.

This BEATS the original 16, hits the SRP intent (sub-objects with honest
nullability replace nullable-by-comment singletons), and is the minimum
that preserves all acceptance-tested behavior. The literal "≤10" target
in the prompt is not satisfiable while preserving the
`loading_session_list → resuming_session` deep-link continuation invariant
(DESIGN §3.2.B requires intent_session_id to survive the async invoke
boundary; pure event-payload elimination would break the deep-link contract).

## Nullability improvements

Before — every cluster field declared `T | null` with a comment "populated on X entry":
- `session_list: SessionSummary[]` (always set to `[]` when not in `session_list_visible`)
- `session_list_next_cursor: string | null`
- `session_list_has_more: boolean`
- `session_id: string | null`
- `transcript: TranscriptMessage[]`
- `resource: { type: ResourceType | null; id: string | null }`

After — sub-object nullability matches state-graph lifecycle:
- `session_list_view: SessionListView | null` — null in `waiting_for_project`, `loading_session_list`, `resuming_session`; non-null in `session_list_visible`.
- `active_session: ActiveSession | null` — null until first `session_active` entry; non-null in `session_active*`.

Type-level invariant: when `session_list_view !== null`, ALL three of items/next_cursor/has_more are present and valid. The "populated on X entry" comments are deleted.

## Deferred (NOT this MR)

L1 smells noticed during the scan (logged for future):
- session-chat.ts has 4 near-identical `project_ready` reset blocks in `waiting_for_project`, `loading_session_list`, `session_list_visible`, `session_active`, and `session_active_no_messages` (duplicated assign object). Candidate for L1 deduplication via an `applyProjectReady` action.
- The noop-actor pattern (`deps.loadSessionList ?? fromPromise(throwing)`) is repeated 3 times. Candidate for an L1 helper.

L2 (complexity) smells noticed:
- `resuming_session.onDone[1].actions.assign.resource` is a 6-line discrimination that could move into a `resolveResource(event.output)` pure function. L2 candidate.

LEAF-4 — child-actor spawn pattern: stays available as a future move toward
Hierarchical State Machines if MR-5/MR-6 ever needs per-cluster lifecycle
isolation. Out of scope for this L3 pass.
