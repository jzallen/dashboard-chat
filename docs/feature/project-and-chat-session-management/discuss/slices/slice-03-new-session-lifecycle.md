# Slice 3 — New session lifecycle

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

A user clicks "+ New Session" and lands instantly in a welcome
state with chips visible AND a chat input enabled — without
creating a session row in the backend. The session row is created
lazily on the first message, with the title set from that
message.

## IN scope

* J-002 states: `session_active_no_messages`, `session_active`
  (write path: lazy create on first_message_sent).
* Backend `create_session(project_id, user)` invoked on
  `first_message_sent` (not on `new_session_clicked`).
* Backend `update_session(session_id, {title: msg[:80]})`
  fire-and-forget after create succeeds.
* Composer text preservation across `error_recoverable` retry.
* No-ghost-row invariant: navigation away from
  `session_active_no_messages` leaves NO session row.

## OUT scope

* Project switching (Slice 4), dataset context (Slice 5),
  FREEZE/THAW (Slice 6).
* Session title editing UI (single-step CRUD; already covered
  by existing `update_session` use case + `features/chat-first-ui.feature:147-150`).

## Stories

* **US-206**: New session lifecycle (lazy create on first message;
  title from first message).

## Learning hypothesis

* **Disproves if it fails**: the lazy-creation ergonomic. If
  users feel the "New Session" click should produce a visible
  artifact (e.g., they navigate away in confusion thinking the
  click didn't register), we revert to eager-create with a
  garbage-collection sweep for empty sessions.
* **Confirms if it succeeds**: J-002 owns the session lifecycle
  cleanly; backend session rows correspond 1:1 with sessions
  that have at least one message (no ghost rows).

## Acceptance criteria (slice-level)

* [ ] `new_session_clicked` transitions to
  `session_active_no_messages` instantly (no backend round-trip);
  `state.session_id` is null.
* [ ] Welcome chips ("Upload CSV", "Browse Projects") visible;
  chat input enabled; project chip preserved.
* [ ] `first_message_sent` triggers `create_session` + transition
  to `session_active`.
* [ ] Title set from first message (truncated to 80 chars) via
  fire-and-forget `update_session`; appears in the recent-sessions
  nav within 1 second.
* [ ] Navigation away from `session_active_no_messages` without
  typing leaves NO session row in the backend (acceptance test
  asserts this).
* [ ] Composer text preserved across an `error_recoverable` retry
  (transient `create_session` failure).
* [ ] TS harness exposes `harness.j002.start_new_session()` and
  `harness.j002.send_first_message(content)`.

## Dependencies

* **Upstream**: Slice 1 (project_selected); Slice 2
  (session_list_visible — the New Session affordance lives in
  the nav rail rendered by Slice 2).
* **Substrate**: `create_session` + `update_session` use cases
  exist; no backend change.

## Effort estimate

* ~1 day (1 story; the `session_active_no_messages` state is
  light; the `create_session` + `update_session` orchestration is
  ~half a day; the composer-preservation contract is ~half a day).

## Pre-slice SPIKE

None. Lazy-create is a small machine change.

## Dogfood moment

A developer clicks "+ New Session" 5 times, navigates away each
time without typing, then verifies via `SELECT COUNT(*) FROM sessions
WHERE owner_id = <dev-user>` that no ghost rows were created.

## Production-data check

Real `create_session` calls; real `update_session` title-set; real
session table.

## Carpaccio taste tests

* "Ship 4+ new components"? No — 1 welcome-state UI; 1 composer
  contract change.
* "Depends on a new abstraction"? No.
* "Disproves a pre-commitment"? Yes — the lazy-create ergonomic.
* "Synthetic data only"? No.
* "Identical to another slice at scale"? No.
