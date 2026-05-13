# Journey Inventory — J-002 entry

> **Wave**: DISCUSS — `project-and-chat-session-management`
> **Date**: 2026-05-13
> **Author**: Luna (nw-product-owner)

This file extends the existing catalog at
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md`
(J-001 deliver-archived) with the **deep-dive** entry for **J-002**.
The other six catalog rows (J-003..J-007 and cross-cutting concerns)
are unchanged; they will be deep-dived by future DISCUSS passes per
the prioritization in
`docs/research/user-flow-inventory-and-gaps.md` §5.

Each entry carries (per the J-001 wave's schema):

* **Trigger** — what starts the flow
* **Goal** — what the user is trying to accomplish
* **Persona** — who the primary actor is
* **Emotional arc** — opening state → peak tension → resolution
* **Entry / Exit observable** — the visible artifact the flow produces
* **Headless surface today** — what (if anything) the TS harness can
  already do
* **State machine** — the flow's named states (now FULL, not catalog
  seed)
* **Status** — `deep-dive` | `catalog` | `future`
* **Scope dependency** — which slice of `active_scope` must already
  be resolved (`org → project → resource`)
* **Cross-machine participation** — does this flow participate in
  the orchestrator's FREEZE/THAW broadcast?

---

## J-002 — Project + chat session management *(deep-dive — this wave)*

* **Trigger**: User completes J-001 (transitions to `ready` with
  `session.current` populated) OR navigates within the app shell OR
  opens a cold deep link to a project URL.
* **Goal**: Materialize `active_scope.project_id` and (when in a
  session) `state.session_id` + `active_scope.resource_*` so every
  downstream user action operates inside a coherent project+session
  context.
* **Persona**: **Maya Chen (returning)** for the deep-dive happy
  path; **Maya (first-time-in-org)** for the no-projects branch;
  **Maya (clicking a bookmark)** for the deep-link branch.
* **Emotional arc**: Anticipatory (cold open) → Oriented (project
  chip + session list paint together) → In-flow (transcript,
  suggestion chips, dataset chip restoration) → Confident (chat turn
  lands with scope intact). Token expiry: Mild interruption →
  Restored. Stale deep link: Mild surprise → Reoriented.
* **Entry observable**: A project chip appearing in the app shell
  OR the no-projects empty-state copy ("Welcome to ${org.name},
  ${user.first_name}!").
* **Exit observable**: `session_active` — transcript visible, dataset
  chip (if present) restored from session metadata, chat input
  enabled. The next user-action (chat turn, dataset switch, project
  switch) is J-002 → J-002 or J-002 → J-003 (upload exit) or J-002
  → exit_to_projects_page (navigation).
* **Headless surface today** *(after this DISCUSS wave; implemented
  in DELIVER)*: TS harness `harness.j002.{open_project,
  open_deep_link, resume_session, start_new_session,
  send_first_message, switch_project, attach_dataset_via_agent,
  attach_dataset_directly, assert_scope, assert_session_active,
  assert_agent_received_scope, freeze, thaw}`. Composes with
  J-001's `harness.user_flow.begin_auth(persona)` via the shared
  TS harness fixture.

  Python harness: existing `DatasetLayerHarness` is extended only
  with `chat_turn_with_scope_header(scope, message)` to assert the
  agent's X-Active-Scope reading. The Python harness does NOT grow
  to cover J-002's user-flow surface — that's the TS harness's
  domain per JOB-002 boundaries.

* **State machine**: 12 named states + 1 side-state + 2 exit
  transitions. See `journey-project-and-chat-session-management.yaml`.

  Top-level happy path:

  ```text
  resolving_initial_scope
    → project_selected
    → loading_session_list
    → session_list_visible (or no_sessions_empty_state)
    → session_active (via resuming_session or session_active_no_messages → first_message_sent)
  ```

  Side-states:
  * `creating_project` (in-flight after no_projects_empty_state CTA)
  * `switching_project` (in-flight; invalidates session_id + resource_*)
  * `switching_dataset_context` (in-flight; updates resource_*)
  * `scope_mismatch_terminal` (cross-tenant or revoked deep-link)
  * `error_recoverable` (transient backend failures during in-flight states)
  * `freeze` (cross-machine FREEZE/THAW participation)

* **Scope dependency**: **requires** `{org_id}` from J-001's
  projection (consumed verbatim; ScopeResolver invariant 1
  enforces JWT-claim parity). **PRODUCES**
  `active_scope.project_id` AND optionally
  `active_scope.resource_type/resource_id`. This is the chain link
  that every downstream flow (J-003..J-007) inherits.

* **Cross-machine participation**:
  - **Consumes** orchestrator FREEZE broadcast on J-001
    `expired_token` (US-209).
  - **Produces** intent events that the orchestrator may queue in
    the replay buffer during freeze (5s timeout, 16 max per flow
    per ADR-027 §5).
  - **Does NOT** broadcast its own cross-machine signals. J-002 is
    a downstream-of-J-001 consumer, not an upstream emitter.

* **Status**: `deep-dive`. See
  `journey-project-and-chat-session-management.yaml`,
  `journey-project-and-chat-session-management-visual.md`, and
  `journey-project-and-chat-session-management.feature`.

---

## Carried forward (unchanged from prior wave)

The catalog at
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md`
also lists:

| # | Flow | Status before this wave | Status after this wave |
|---|------|-------------------------|------------------------|
| 1 | login-and-org-setup | deep-dive (delivered) | active (SSOT-promoted) |
| 2 | project + chat session mgmt | catalog | **deep-dive (this wave)** |
| 3 | dataset upload | catalog | catalog (next likely dive after J-002 per research §5) |
| 4 | table preview | catalog | catalog |
| 5 | transforms | catalog | catalog |
| 6 | view + report | catalog | catalog |
| 7 | dbt export | catalog | catalog |

Cross-cutting concerns (token expiry, org switching) remain as
constraints on every flow, not separate journeys. See
`wave-decisions.md` §D10 for the J-002-specific resolution on
org-switching.

---

## Implied flows reconsidered

The research at
`docs/research/user-flow-inventory-and-gaps.md` §4 surfaced two
implied flows beyond J-NNN: external SQL access and query-engine
node management. **Neither is in J-002's scope.** They remain Open
Q#1 in the research (out of this wave per command-args).

---

## Scope dependency table — extended

J-002's row in the chain (from
`docs/evolution/2026-05-12-user-flow-state-machines/discuss/journey-inventory.md:281-289`):

| # | Flow | Requires `org_id` | Requires `project_id` | Requires `resource_id` | Produces |
|---|------|-------------------|-----------------------|------------------------|----------|
| 1 | login-and-org-setup | — | — | — | `org_id` |
| 2 | **project + chat session mgmt** | **YES** (from J-001) | — (this flow produces it) | — | **`project_id`** AND optionally **`resource_id`** when in `session_active` with a dataset attached |
| 3 | dataset upload | YES | YES (from J-002) | — | new `dataset_id` |
| 4 | table preview | YES | YES | YES | — |
| 5 | transforms | YES | YES | YES | new transform record |
| 6 | view + report | YES | YES | — | new `view_id`/`report_id` |
| 7 | dbt export | YES | YES | — | downloadable zip |

J-002 produces the `project_id` slice of `active_scope`. Every
downstream flow's `resource_id` slice is **also** produced by J-002
when the resource is dataset/view/report-typed and a session is
active.

---

## Changelog

* 2026-05-13 — Promoted J-002 from `catalog` to `deep-dive`. Authored
  by Luna in DISCUSS wave for `project-and-chat-session-management`.
