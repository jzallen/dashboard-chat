# Slice 2 — Session list + resume

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

After project selection (Slice 1), the project's session list
renders sorted most-recent-first AND a user can resume any
session — with both the transcript and the dataset chip restored
from session metadata.

## IN scope

* J-002 states: `loading_session_list`, `session_list_visible`,
  `no_sessions_empty_state`, `resuming_session`, `session_active`
  (read-only paint; write-path is Slice 3+).
* Backend `list_sessions(project_id, user)` + paginated load
  for the Chats page.
* Backend `list_session_events(session_id, user)` for transcript
  load.
* Session-metadata `active_dataset_id` storage (D11 / OQ-J002-1
  resolution by DESIGN before this slice starts DELIVER).
* `scope_resolved` event on dataset-context-restore (for the
  graceful-degradation path when stored dataset is deleted).

## OUT scope

* New session lifecycle (Slice 3).
* Project switching, dataset switching mid-session (Slice 4/5).
* Agent X-Active-Scope enforcement (Slice 4).
* FREEZE/THAW (Slice 6).

## Stories

* **US-203**: Session list renders sorted by recency; recent-sessions
  nav caps at 5; cross-tab session-creation refreshes via projection
  stream.
* **US-205**: Resuming a session restores transcript AND dataset
  chip from session metadata; graceful degradation when stored
  dataset is deleted.

## Learning hypothesis

* **Disproves if it fails**: that session metadata can carry
  per-session UX state (the `active_dataset_id` field). If
  resumed sessions arrive with wrong/missing dataset chip more
  than 1 in 100 times, D11's storage shape is wrong and we go
  back to DESIGN.
* **Confirms if it succeeds**: J-002 owns session-bound state
  (including dataset context) durably; the agent stays stateless;
  the chat-first-ui.feature's session-resume promise is finally
  honored.

## Acceptance criteria (slice-level)

* [ ] Session list paints with the project chip on the same
  first paint at p99.
* [ ] Sessions are sorted server-side by `last_active_at DESC`;
  no client-side re-sort.
* [ ] Recent-sessions nav rail shows the 5 most-recent items;
  the Chats page shows the first 30 with pagination.
* [ ] Zero-sessions project enters `no_sessions_empty_state` with
  welcome chips visible; chat input enabled.
* [ ] Session resume materializes transcript AND `active_scope.resource_*`
  before transitioning to `session_active`; both paint together.
* [ ] Deleted-dataset graceful degradation: dataset chip shows
  empty-state copy; transcript still renders.
* [ ] Cross-tab session-creation refreshes the list via the
  projection stream within 1 second.
* [ ] TS harness exposes `harness.j002.get_session_list()`,
  `harness.j002.resume_session()`, `harness.j002.get_transcript()`.

## Dependencies

* **Upstream**: Slice 1 (project_selected state, app-shell paint
  pattern).
* **DESIGN-deferred**: OQ-J002-1 (session-metadata storage shape).
  This slice **cannot start DELIVER** until DESIGN resolves OQ-J002-1.
  Three options on the table per D11; DESIGN picks one.

## Effort estimate

* ~1.5 days (2 stories × ~0.75 days each).

## Pre-slice SPIKE

**OQ-J002-1 resolution by DESIGN**. The session-metadata storage
shape is the load-bearing question for this slice. DESIGN picks
one of:

* **Option A**: New `active_dataset_id` column on the session row.
  Simplest. Requires Alembic migration.
* **Option B**: Side-log of dataset-context changes per session
  in a new table. More auditable; supports history. Bigger schema delta.
* **Option C**: Denormalization from session-event stream. Requires
  Stream.io reader (currently noop per
  `backend/app/use_cases/session/event_replay.py`). Highest
  conceptual purity; biggest infra dependency.

DESIGN's choice may sequence this slice differently (Option C
requires Stream.io adapter ahead of DELIVER; Options A/B do not).

## Dogfood moment

A developer attaches a dataset to a session (via Slice 5's path,
or manually via the API), closes the tab, re-opens it cold,
clicks the same session in the nav rail, observes the dataset
chip restored.

## Production-data check

Real session rows from the dev backend; real dataset rows;
real `active_dataset_id` populated via the API or Slice 5's
write path.

## Carpaccio taste tests

* "Ship 4+ new components"? No — 2 panels (session list, transcript) +
  1 dataset chip = 3.
* "Depends on a new abstraction"? Yes — the session-metadata
  shape is new. **Ship it as a pre-slice SPIKE** (Option A's
  Alembic migration, OR Option B's side-log table, OR Option C's
  Stream.io adapter wire-up) BEFORE Slice 2's stories land.
* "Disproves a pre-commitment"? Yes — D11's storage shape.
* "Synthetic data only"? No.
* "Identical to another slice at scale"? No.
