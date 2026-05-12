# Journey Inventory — Dashboard Chat User Flows

> **Wave**: DISCUSS (`user-flow-state-machines`)
> **Date**: 2026-05-11
> **Author**: Luna (nw-product-owner)

Catalog of the eight user flows in scope for the
`user-flow-state-machines` feature. The first flow,
`login-and-org-setup`, is **deep-dived** in this DISCUSS pass (full
visual + YAML + Gherkin + stories). The remaining seven appear here as
**catalog entries** sufficient to populate the story map backbone and
seed future DISCUSS passes.

Each entry carries:

* **Trigger** — what starts the flow
* **Goal** — what the user is trying to accomplish
* **Persona** — who the primary actor is
* **Emotional arc (1-2 sentences)** — opening state → peak tension → resolution
* **Entry / Exit observable** — the visible artifact the flow produces
* **Headless surface today** — what (if anything) the harness can already do
* **State machine seed** — the flow's named states (best draft)
* **Status** — `deep-dive` | `catalog` | `future`
* **Scope dependency** *(Round-2)* — which slice of `active_scope` (Org →
  Project → Resource) must already be resolved before the flow can begin.
  See `shared-artifacts-registry.md` §`active_scope` for the artifact
  shape.

---

## 1. Login + WorkOS callback — `login-and-org-setup` *(deep-dive)*

Combined with org setup because they are inseparable in the user's
experience (first-time login lands in CreateOrg).

* **Trigger**: User opens the app in a fresh browser session, OR a
  token expires mid-session.
* **Goal**: Reach a state where the app knows who the user is and which
  org they are operating against, with both pieces of state
  consistently reflected across the FE shell, the chat session, and
  any concurrent test harness observing the user.
* **Persona**: **Maya Chen** — a new contributor to a data team; first
  time opening Dashboard Chat. Has a WorkOS identity through her
  employer's IdP but no org in the app yet. (Secondary persona:
  **returning user** — already has org, returning after JWT expiry.)
* **Emotional arc**: Curious → mildly anxious (callback redirects, no
  loading state, "did it work?") → confident-and-oriented (sees the
  app shell with her org name + her display name in the header).
* **Entry observable**: `/login` page or root with a "Sign in" button.
* **Exit observable**: App shell rendered with `${user.display_name}`
  and `${org.name}` visible in chrome; first chat session pre-created
  and selectable.
* **Headless surface today**: `AuthApi.fetch_dev_user_jwt` and
  `AuthApi.mint_pat` in `DatasetLayerHarness`. No
  `OrgApi` / first-run wizard surface. No assertions on FE rendering
  state.
* **State machine seed**: `anonymous` → `authenticating` →
  `authenticated_no_org` → `creating_org` → `ready` (with side-states
  `expired_token` and `error_recoverable`).
* **Scope dependency**: **NONE on entry** (this is the only flow that
  starts pre-scope). **PRODUCES** `org_id` at `ready` entry, populating
  `active_scope.org_id` for every subsequent flow.
* **Status**: `deep-dive`. See `journey-login-and-org-setup.yaml` and
  `journey-login-and-org-setup-visual.md`.

---

## 2. Project + chat session management *(catalog)*

* **Trigger**: User in `ready` state clicks "New project" or opens an
  existing one.
* **Goal**: Open a project context, see its existing chat sessions,
  and pick the right session (or start a new one) so the chat panel
  has a thread to render.
* **Persona**: Returning user with at least one prior project. *(Maya
  qualifies once she has finished step 1.)*
* **Emotional arc**: Oriented → momentarily *spatial* ("which session
  was I in last?") → re-oriented (session list shows recency
  ordering, last-message preview, dataset binding hint).
* **Entry observable**: SideNav project tree.
* **Exit observable**: A chat thread is selected; ChatTranscript
  renders prior messages OR an empty-state with a "what would you
  like to do?" prompt.
* **Headless surface today**: `SessionsApi.create` and
  `SessionsApi.list_events` in `DatasetLayerHarness`. No notion of
  "currently selected session"; the harness just creates fresh ones
  per test.
* **State machine seed**: `project_chosen` → `loading_sessions` →
  `session_list_visible` → `session_selected` (with
  `creating_new_session` and `no_sessions_empty_state` side-states).
* **Scope dependency**: requires `{org_id}` on entry. **PRODUCES**
  `project_id` at `project_chosen` entry, populating
  `active_scope.project_id` for every downstream flow (3-7).
* **Status**: `catalog` — placeholder story-map column; next DISCUSS pass.

---

## 3. Dataset upload (chat-driven and direct) *(catalog)*

* **Trigger**: User in a project session drags a CSV onto the upload
  zone OR asks the chat agent "upload this CSV for me" with a path.
* **Goal**: Get a dataset registered, see its initial schema preview,
  and know that it is bound to the current chat thread for transforms.
* **Persona**: Data engineer or analyst with a CSV ready to inspect.
* **Emotional arc**: Hopeful (this is the first concrete win) → tense
  (long-feeling upload + schema inference) → satisfied (the
  TablePanel populates with real rows; the chat acknowledges binding).
* **Entry observable**: UploadWidget OR chat prompt.
* **Exit observable**: Dataset visible in the project tree; its
  preview rendered; chat acknowledges binding.
* **Headless surface today**: `UploadsApi.upload_csv` in
  `DatasetLayerHarness`. Direct-upload path is well-tested; the
  chat-driven path is partially tested via the same harness's
  `chat_turn`.
* **State machine seed**: `no_dataset` → `uploading` →
  `schema_inferring` → `bound_to_session` (with `upload_failed` and
  `unsupported_format` side-states).
* **Scope dependency**: requires `{org_id, project_id}`. **PRODUCES**
  a new `dataset_id` that becomes selectable as
  `active_scope.resource_type=dataset` for subsequent flows (4-5).
* **Status**: `catalog`.

---

## 4. Table / dataset preview *(catalog)*

* **Trigger**: User selects a dataset in the SideNav OR a chat turn
  emits a `dataset_attached` event.
* **Goal**: Read the dataset — see columns, sort, filter, scroll — to
  build intuition before asking for transforms.
* **Persona**: Analyst doing exploratory work.
* **Emotional arc**: Curious → in-flow (sort/filter feel responsive)
  → grounded (the table feels real, like a spreadsheet).
* **Entry observable**: DatasetView with no transforms applied.
* **Exit observable**: User has applied at least one sort or filter
  AND/OR has scrolled past the initial preview window. (The exit
  observable is fuzzy — this flow runs in parallel with #5 and #6.)
* **Headless surface today**: ADR-015's `presentation-state`
  endpoint — directives flow into the log; a TS or Python consumer
  can replay them. The FE applies them in-process via `applyDirective`.
* **State machine seed**: `preview_loading` → `preview_rendered` →
  `interactive_idle` ↔ `sort_applied` / `filter_applied` /
  `column_hidden`.
* **Scope dependency**: requires `{org_id, project_id, resource_id}` with
  `resource_type ∈ {dataset, view, report}`. This is the first flow where
  the **full chain** including `resource_type` must be resolved before
  entry — the framework's scope-chain expression mechanism is exercised
  most directly here.
* **Status**: `catalog`. **Note**: this flow is the closest in
  spirit to ADR-015's existing model; the deep-dive into it would
  exercise the "promote directive-log to flow-machine" question
  directly.

---

## 5. Transform toggles (cleaning preview / apply / undo) *(catalog)*

* **Trigger**: User asks chat to clean a column, OR clicks a cleaning
  control in TransformSettings.
* **Goal**: Try a transform, see what it would do, accept or reject,
  and feel safe undoing.
* **Persona**: Analyst comfortable with chat-driven assistance but
  wanting an audit trail of every change.
* **Emotional arc**: Curious → momentarily anxious ("will this destroy
  my data?") → confident (preview shows side-by-side; undo is one
  click; OperationsLog shows what happened).
* **Entry observable**: TransformSettings panel OR a chat suggestion
  card.
* **Exit observable**: Dataset has a new transform record; preview
  reflects it; user can undo.
* **Headless surface today**: `TransformsApi.post_direct`,
  `TransformsApi.patch_direct`, `DatasetsApi.list_transforms`,
  `assert_exactly_once_via_replay` — best-covered flow in the existing
  harness.
* **State machine seed**: `transform_idle` → `previewing` →
  `confirming` → `applied` ↔ `undoing` (with `transform_failed` and
  `validation_failed_pandera` side-states from ADR-019).
* **Scope dependency**: requires
  `{org_id, project_id, resource_type=dataset|view, resource_id}`.
  Transforms are dataset/view-bound; the SQL preview sub-UI inherits the
  same scope.
* **Status**: `catalog`. **Note**: this is the flow with the strongest
  existing server-side state (transform log is durable, replay-aware,
  idempotent). The state-machine pattern would primarily formalize the
  *preview* sub-state.

---

## 6. View + report creation *(catalog)*

* **Trigger**: User asks chat to "create a view that joins X and Y"
  OR uses a UI form in ViewDetailView / ReportDetailView.
* **Goal**: Compose a join (view) or aggregation (report) on top of
  one or more datasets and see the resulting table.
* **Persona**: Analyst with two or more datasets bound to the project,
  ready to compose.
* **Emotional arc**: Anticipatory → focused (compose step requires
  thought) → satisfied (the resulting table is browsable; the
  underlying SQL is inspectable via SqlAccessPanel).
* **Entry observable**: ViewDetailView OR ReportDetailView empty
  state OR a chat suggestion card.
* **Exit observable**: View or report appears in the project tree
  alongside its source datasets.
* **Headless surface today**: Backend endpoints exist; no harness
  wrapper. The chat-driven path is exercised by `chat_turn` plus
  manual API verification.
* **State machine seed**: `view_compose_idle` → `defining` →
  `validating` → `materialized`. (Report is a sibling machine with
  the same shape.)
* **Scope dependency**: requires `{org_id, project_id}` and accesses
  multiple datasets within the project as compose inputs. **PRODUCES** a
  new `view_id` or `report_id` selectable as
  `active_scope.resource_type=view|report` for downstream flows (4-5).
* **Status**: `catalog`.

---

## 7. dbt export *(catalog)*

* **Trigger**: User asks chat "export this project as a dbt project"
  OR uses the export action in the project menu.
* **Goal**: Download a zip of the project's transforms expressed as
  dbt models, schema, and sources, ready to drop into the customer's
  data warehouse.
* **Persona**: Data engineer preparing to migrate work out of the app.
* **Emotional arc**: Decisive ("I'm done iterating") → tense (export
  feels final, also "is the schema right?") → relieved (download
  succeeds; the zip's README explains what to do next).
* **Entry observable**: Export action button OR a chat command.
* **Exit observable**: Browser downloads the zip; toast confirms.
* **Headless surface today**: Backend export endpoint exists; the
  `dbt-test-validation` acceptance suite exercises it end-to-end via
  a procedural driver
  (`tests/acceptance/dbt-test-validation-v2/`). No FE-facing harness.
* **State machine seed**: `export_idle` → `bundling` → `validating` →
  `ready_to_download` (with `bundling_failed` side-state).
* **Scope dependency**: requires `{org_id, project_id}`. The export is
  project-bounded; no individual resource selection is required (the
  whole project is bundled).
* **Status**: `catalog`. **Note**: ADR-019 / ADR-024 have already
  formalized much of this flow's backend state at the test-infra
  level; the FE machine here would be thin.

---

## 8. (Not a separate flow) — cross-cutting concerns

Two cross-cutting concerns surfaced during inventory; not modeled as
separate flow machines but **constraints** every flow's machine must
honor:

* **Token expiry / re-auth.** Any flow can be interrupted by JWT
  expiry. The deep-dive `login-and-org-setup` captures this as the
  `expired_token` side-state; every other flow inherits it as a
  transition target.
* **Org switching.** Multi-tenant: when a user switches orgs (future
  feature), every flow state machine resets. The state-machine layer
  must expose this as a top-level "reset all machines" signal. Out of
  scope for the deep-dive but flagged for DESIGN.

---

## Inventory summary

| # | Flow | Status | Existing harness coverage | Existing FE state machine |
|---|------|--------|---------------------------|---------------------------|
| 1 | login-and-org-setup | **deep-dive** | partial (token fetch only) | scattered across MainShell |
| 2 | project + session mgmt | catalog | partial (`SessionsApi`) | scattered across SideNav + SessionList |
| 3 | dataset upload | catalog | strong (`UploadsApi` + chat_turn) | UploadWidget local state |
| 4 | table preview | catalog | ADR-015 directive log | `applyDirective` reducer |
| 5 | transforms | catalog | strong (full transforms API + replay) | TransformSettings + OperationsLog |
| 6 | view + report | catalog | weak (chat_turn only) | ViewDetailView + ReportDetailView |
| 7 | dbt export | catalog | strong (acceptance suite) | minimal FE machine |

## Scope dependency summary *(Round-2)*

Every flow's required `active_scope` slice, by precondition. The chain
`org → project → resource` is established by flows 1, 2, and 3/6
respectively; every other flow inherits.

| # | Flow | Requires `org_id` | Requires `project_id` | Requires `resource_id` | Produces |
|---|------|-------------------|-----------------------|------------------------|----------|
| 1 | login-and-org-setup | — | — | — | `org_id` |
| 2 | project + session mgmt | YES | — | — | `project_id` |
| 3 | dataset upload | YES | YES | — | new `dataset_id` |
| 4 | table preview | YES | YES | YES (dataset/view/report) | — |
| 5 | transforms | YES | YES | YES (dataset/view) | new transform record |
| 6 | view + report | YES | YES | — (consumes datasets as inputs) | new `view_id`/`report_id` |
| 7 | dbt export | YES | YES | — | downloadable zip |

The chat agent (per Round-2 D8) receives `org_id` + `project_id` on every
turn and optionally `dataset_id[]` for in-request scope. Cross-flow
state-machine consumers MUST pull scope from `active_scope`, not from
parallel re-derivations.
