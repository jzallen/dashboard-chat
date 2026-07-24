<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — `normalize-view-report-operations` — DISTILL

**Feature:** normalize-view-report-operations
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-07-24
**Author:** Quinn (nw-acceptance-designer)
**Linear:** DC-78 (stories DC-81..DC-88)
**Prior waves:** DISCUSS (8 user stories + user story map, validated) · DESIGN (ADR-052 Proposed, domain-model Option B, C4, wave-decisions, validated)

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

DISCUSS (`user-stories.md`, `story-map.md`, `prioritization.md`,
`wave-decisions.md`) and DESIGN (`domain-model.md`, `c4-component.md`,
`wave-decisions.md`, ADR-052) are internally consistent and consistent with each
other. DISCUSS defined 8 user stories (01–08) grouped into release slices in
`story-map.md` — a Release Slice groups one or more stories, not inherently 1:1 —
tracking to Linear stories DC-81..DC-88. Every ADR-052 acceptance
criterion (AC1–AC7) and Earned-Trust probe (P1–P5) traces to at least one story
and at least one acceptance scenario (`user-stories.md` §"Requirements
completeness"). See `upstream-issues.md` for the full check list.

This feature runs **feature-folder mode**: there is a `docs/product/` SSOT but
this feature traces to **ADR-052**, not a `journeys/*.yaml` (it is an internal
backend refactor; JTBD was intentionally skipped per DISCUSS D1). The
architecture SSOT for driving ports is ADR-052 + `design/c4-component.md`; no
`kpi-contracts.yaml` applies (no user-facing metric — soft gate warned and
skipped). No DEVOPS handoff (DESIGN recorded no external integration / no
topology change); the acceptance environment is one substrate: in-process
aiosqlite + real ibis.

---

## Decisions

* **[DWD-1] No walking skeleton — the product owner directs a RED acceptance
  test per Scenario as the DELIVER gate.** There is no vertical walking-skeleton
  slice: the product owner steers DELIVER one scenario at a time (a RED
  acceptance test per Scenario is the gate; Claude handles vertical slices
  poorly). Render-equivalence is not pinned as a golden snapshot of existing or
  seeded relations — there is NO legacy/production View or Report data, and
  View/Report are display-only. Instead render-equivalence survives ONLY as a
  self-contained in-test pre-vs-post property: for a fixture BUILT IN THE TEST,
  the pre-normalization render path (or the separate View/Report compilers) is
  compared against the post-normalization render path (or the consolidated
  compiler). The real substrate stays real — every scenario persists through the
  real `RepositoryContainer.metadata` adapter (aiosqlite, the same substrate
  `backend/tests/conftest.py` uses) and renders through the real compilers
  (`ViewIbisCompiler` / `ReportIbisCompiler` → `ibis.to_sql(dialect="duckdb")`),
  tagged `@real-io`; if either adapter were swapped for a stub the equivalence
  scenario would prove nothing (Mandate 6). No `@requires_external` markers: no
  costly external in scope.

* **[DWD-2] OQ-2 resolved — `report_type` (`fact`/`dimension`) is a semantic
  LABEL, not a render-affecting structural component.** Grounding: `report_type`
  is read ONLY by the dbt-eject manifest layer
  (`backend/app/use_cases/project/_dbt/manifest.py:42` → `fct`/`dim` prefix),
  never by the ibis compiler (`report_ibis_compiler.py` does not branch on it —
  confirmed by ADR-052 OQ-2 and the code map). Resolution: `report_type` stays a
  typed attribute stored on the report row; it is **NOT** a `relation_*`
  component row and **NOT** render-affecting. No acceptance scenario treats it as
  structural. Recorded here per the DISCUSS routing (OQ-2 → DISTILL, slice 07).

* **[DWD-3] OQ-3 resolved — `relation_grain` is ONE row per parent (1:1).**
  Grounding: `View.grain` is `ViewGrain | None` — a single immutable value
  object, 1:1 per view (`backend/app/models/view.py:291`); Report has no grain.
  Resolution: `relation_grain` = exactly one row per parent, matching `ViewGrain`
  1:1 (not one row per grain key). The story 06 acceptance scenario "The backfill
  produces exactly one grain row per relation" pins this cardinality. Recorded
  per the DISCUSS routing (OQ-3 → DISTILL, slice 06).

* **[DWD-4] Expand/contract migration discipline is a first-class acceptance
  concern, split across phases.** Each `relation_*` slice (03–07) ships the
  EXPAND half (create table + backfill + write-both/read-rows) with the JSON
  column RETAINED that release; slice 08 ships the CONTRACT half (drop columns)
  gated behind ONE production release of 03–07. Joins backfill by array position,
  not `created_at` (ADR-052 decision 5; story 05 scenario "The backfill assigns
  join sequence from array position not creation time" pins it). The contract
  slice (08) is `@infrastructure` / `@contract_migration` and carries a rollback
  scenario (re-add + re-backfill). DISTILL surfaces the ordering constraint for
  DELIVER to encode: the DELIVER roadmap must order slice 08 after slices 03–07
  and behind the one-release gate.

* **[DWD-6] Polymorphic-cascade enforcement (OQ-4) is ESTABLISHED in story 03
  and routed to DELIVER for the mechanism choice.** OQ-4 (repository delete path
  + `parent_type` CHECK vs DB trigger) is a DELIVER-with-the-migration decision
  per DESIGN's routing — DISTILL does not pre-decide the mechanism. But the
  BEHAVIOR it must produce is pinned by acceptance scenarios now: story 03's
  "Deleting a relation removes only its own filter rows" + "the other relation's
  filter rows remain intact" (tagged `@polymorphic_cascade`) is the P5 probe made
  executable. The recommended mechanism (repo delete path + CHECK) is surfaced for
  DELIVER to weigh at the slice 03 migration; the acceptance scenario is agnostic to the
  mechanism and asserts only the observable cascade outcome, so DELIVER may
  choose trigger-vs-repo-path without a test rewrite.

* **[DWD-7] Eight feature files, 27 scenarios, one file per story.** Eight
  milestone features (stories 01–08) grouping each story's scenarios. Per-file
  counts: 01 report-typed-kernel = 3; 02 kernel-visitor-renderer = 3; 03
  relation-filters = 5; 04 relation-columns = 4; 05 relation-joins = 3; 06
  relation-grain = 3; 07 relation-aggregations = 4; 08 drop-json = 2. Total **27
  scenarios**. This is above the recommended 15–20 focused range because the
  feature legitimately spans five normalized component tables + a renderer
  consolidation + a boundary-typing lift + a contract migration — eight
  independently-shippable stories, each with its own learning hypothesis.

* **[DWD-8] Error/edge coverage: 12 of 27 scenarios (44%).** Exceeds the 40%
  floor — and rose from the prior 43% because dropping the three render-
  characterization scenarios removed two happy-path snapshots and one
  drift-detection scenario (net: the error/edge share of the remaining set
  increased). Counted as error/edge anything whose observable outcome is a
  rejection, a negative invariant (reorder-invariance), a cascade-only-own-rows
  assertion, a mart-to-mart/dimensionless rejection, or a completeness failure:
    - **Boundary rejections (4):** unknown semantic_role, illegal role/type pair
      (story 01); measure-without-dimension, mart-to-mart (story 07).
    - **Reorder-invariance negatives (5):** filters reorder → SQL unchanged
      (03); columns reorder + position change → SQL unchanged (04); grain keys
      reorder → SQL unchanged (06); aggregations reorder → SQL unchanged (07).
    - **Cascade / tenant (2):** delete removes only own rows + others intact
      (03); org-scoped filter load (03).
    - **Completeness (1):** unhandled discriminator fails the build (02).

* **[DWD-9] Default test filter: `-m "not pending"`.** Every story 01–08
  milestone feature is tagged `@pending` at the Feature level and is enabled one
  scenario at a time by DELIVER as the product owner directs each RED acceptance
  test. With no non-pending scenarios, the default selection collects the full 27
  and deselects them all until DELIVER unpends. Mirrors the sibling
  `refactor-metadata-repository-split` suite and every other `tests/acceptance/`
  suite.

* **[DWD-10] Mandate-7 RED scaffolds: every milestone step uses
  `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`.** No production
  scaffold module is created by DISTILL: the render-equivalence property is
  asserted entirely in-test (pre-vs-post render of an in-test fixture), so there
  is no not-yet-existing production module the ACTIVE steps must import. The
  kernel-visitor / render-catalog / typed-projection / shared-component-repository
  modules the milestone stories introduce are imported only inside `@pending`
  step bodies that `pytest.fail` before importing, so scaffolding them now would
  be premature; DELIVER creates them at their stories. Existing modules
  (`ViewIbisCompiler`, `ReportIbisCompiler`, `RepositoryContainer`,
  `create_view`, `create_report`, `DependencyService`,
  `ReportRequiresDimension`, `InvalidReportReference`) are REUSED, never
  re-scaffolded.

---

## Driving-Port-to-Behaviour Mapping

Every AC names its driving port. For this feature the driving ports are: (a)
`RepositoryContainer.metadata` — the view/report persistence surface
(`create_view` / `get_view` / `create_report` / `get_report` / `delete_view`);
(b) the application-layer use-case functions
`app.use_cases.view.create_view.create_view` and
`app.use_cases.report.create_report.create_report` — the validation boundary;
(c) the public compiler entry points
`ViewIbisCompiler.generate_executable` / `ReportIbisCompiler.generate_executable`
(and, from story 02, the kernel visitor) rendered directly in-test. `@when` steps
import ONLY from `app.use_cases.*` / `app.repositories` (the container) — never a
driven adapter (`ViewRecord`, `ReportRecord`, the `relation_*` records, the
shared component repository).

| Behaviour / AC | Driving port | Observable outcome |
|---|---|---|
| Report boundary rejection (AC4, P4) — Story 01 (DC-81) | `create_report` use-case function | Structured `Failure`/422 on unknown `semantic_role` / illegal role-type pair; nothing persisted; every existing report hydrates |
| Renderer consolidation (AC1, AC2, AC5, P1, P2) — Story 02 (DC-82) | Kernel visitor + report extension, rendered in-test | Same SQL as the separate compilers for the same in-test relation; unhandled discriminator fails build; entity-only report renders via shared path |
| relation_filters normalized (AC6, AC7, P5) — Story 03 (DC-83) | `RepositoryContainer.metadata` (create/update/delete view) | Single-row INSERT; backfill 1 row per JSON element; reorder → SQL unchanged; delete cascades only own rows; org-scoped load |
| relation_columns normalized (AC2, AC6, AC7) — Story 04 (DC-84) | `RepositoryContainer.metadata` (view + report) | Cross-role query returns both roles; reorder/position → SQL unchanged; single-row INSERT |
| relation_joins normalized (AC2, AC3, AC7, P2, P3) — Story 05 (DC-85) | `RepositoryContainer.metadata` (create/update view), rendered in-test | Swapped sequence → SQL differs; sequence-order read → same SQL as the equivalent embedded-array view built in-test; backfill by array position |
| relation_grain normalized (AC2, AC7) — Story 06 (DC-86) | `RepositoryContainer.metadata` (create/update view) | Grain keys queryable as rows; reorder → SQL unchanged; exactly one row per parent |
| relation_aggregations + report rules (AC2, AC4, AC6, AC7) — Story 07 (DC-87) | `create_report` use-case + shared composition service | measure-requires-dimension over typed rows; no-mart-to-mart via composition service; single aggregation row; reorder → SQL unchanged |
| Drop-JSON contract (AC2) — Story 08 (DC-88) | Migration (up/down), rendered in-test | JSON columns dropped; rendered SQL unchanged from before the drop for the same in-test fixture; rollback re-adds + re-backfills |

Every "Observable outcome" cell asserts on a return value from the driving port
or a user-visible signal (rendered SQL string, raised structured `Failure`,
row-count delta, cascade outcome). Zero internal-state assertions, zero
`mock.called` assertions.

---

## Adapter Coverage Table (Mandate 6)

| Driven adapter | `@real-io` scenario | Covered by |
|---|---|---|
| SQLAlchemy/aiosqlite persistence (`RestrictedSession` + in-memory SQLite) | YES | every milestone story seeds through the real `.metadata` adapter over the shared aiosqlite fixture |
| ibis → `to_sql(dialect="duckdb")` renderer (`ViewIbisCompiler` / `ReportIbisCompiler`) | YES | the story 02 kernel-visitor equivalence scenario renders the same in-test relation through both the consolidated and the separate compilers; stories 05, 08 re-render for in-test equivalence |
| `RepositoryContainer.metadata` view/report persistence surface (`create_view`/`create_report`) | YES | every milestone story constructs + invokes `.metadata.create_view`/`create_report` |
| Shared `relation_*` component-table repository (story 03+) | Deferred to DELIVER story | Story 03 pattern-prover scenarios (`@pending`) exercise its real read/write/cascade once implemented; the module is a RED scaffold DELIVER creates at story 03 |
| Expand/contract migration (Alembic) | Deferred to DELIVER story | Stories 03–08 backfill/drop/rollback scenarios (`@pending`) exercise the real migration once written |

The story 02 kernel-visitor equivalence scenario covers the render adapter
(persistence + ibis) through a pre-vs-post in-test comparison. The component-table
repository and the migrations do not exist yet (they are the refactor's product);
their `@real-io` coverage lives in the `@pending` milestone scenarios that DELIVER
unpends as each adapter is built — InMemory doubles cannot catch the wiring,
path-resolution, or SQL-format bugs those scenarios target, so every one drives
the real substrate.

**Costly-external pattern:** none in scope. In-process aiosqlite + in-process
ibis; no `@requires_external` markers.

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary).** All `@when`/`@given` step bodies in
  `steps/relation_steps.py` reach the system through `RepositoryContainer`
  (`.metadata`) and the `create_view` / `create_report` use-case functions and
  the public compiler entry points rendered in-test. Zero imports of `ViewRecord`,
  `ReportRecord`, any `relation_*` record, or the shared component repository in
  the step module. `grep -n "import" steps/relation_steps.py` shows only
  `app.repositories.metadata` for the Org/Project SEED prerequisites
  (`OrganizationRecord`, `ProjectRecord` — background setup, not the behavior
  under test, seeded on the raw `db_session` fixture) and the public use-case /
  compiler entry points inside `@when` bodies.

* **CM-B (Business language).** Gherkin uses domain terms only: "engineer",
  "modeler", "operator", "view", "report", "relation", "column", "filter",
  "join", "grain", "measure", "dimension", "aggregation", "tenant", "renderer".
  Zero technical jargon in `.feature` files: no "API", "HTTP",
  "JSON payload", "POST", "SQLAlchemy", "ibis", "Pydantic", "DuckDB", "422",
  "table", "row", "SELECT" as Gherkin verbs (those live in step defs and
  comments only). "relation", "column", "filter", "join", "grain", "measure",
  "aggregation" are the ubiquitous language of this refactor's
  domain (established in `domain-model.md` §3), and the user for this suite IS the
  backend engineer/modeler — their working vocabulary is domain language.

* **CM-C (User journey completeness).** Each milestone scenario frames a
  mini-journey: build the precondition in-test → act through the driving port →
  observe the outcome (rejection, row delta, invariant, cascade, in-test render
  equivalence). Count: 27 focused scenarios, no walking skeleton (the product
  owner directs a RED acceptance test per scenario as the DELIVER gate).

* **CM-D (Pure function / typed-kernel extraction inventory).** The refactor
  extracts pure typed value objects and pure render steps: `ProjectionColumn` /
  `Measure` discriminated unions (story 01, pure validation over
  `semantic_role`); the kernel visitor's per-component render steps (story 02,
  pure functions of persisted component state → ibis expression); the no-mart-to-mart
  check promoted to a pure method on the shared composition service (story 07).
  These are exercised indirectly through the driving-port scenarios (boundary
  rejection, in-test render equivalence) and will carry direct unit tests in
  DELIVER's inner loop. The render is a pure function of persisted state (AC1) —
  the story 02 pre-vs-post equivalence scenario is the proof.

---

## Self-Review Checklist (Mandate 7 + critique dimensions)

- [x] No walking skeleton — the product owner directs a RED acceptance test per
      scenario as the DELIVER gate (DWD-1); render-equivalence is a self-contained
      in-test pre-vs-post property, not a golden snapshot of seeded relations
- [x] Every render-carrying driven adapter has a `@real-io` scenario (table above);
      not-yet-built adapters' `@real-io` coverage is in the `@pending` story scenarios
- [x] All milestone step bindings have RED-ready scaffolds with self-documenting
      `pytest.fail("DISTILL scaffold — DELIVER implements: ...")` markers
- [x] No production scaffold module created; no existing production module
      re-scaffolded (compilers, container, use cases, exceptions REUSED)
- [x] Error/edge coverage ≥ 40% (DWD-8: 44% over 27 scenarios)
- [x] BDD star-import after `sys.path` manipulation carries `# noqa` markers (conftest.py)
- [x] `@when` step glue imports nothing from driven adapters (CM-A)
- [x] Mandate 1 (CM-A): steps drive `RepositoryContainer` + use-case functions only
- [x] Mandate 2 (CM-B): zero technical terms in `.feature` files
- [x] Mandate 3 (CM-C): 27 focused scenarios, no walking skeleton
- [x] Mandate 4 (CM-D): typed-kernel + pure-render-step extraction inventory recorded
- [x] OQ-2 (report_type = label) + OQ-3 (grain 1:1) resolved and recorded (DWD-2, DWD-3)
- [x] DISCUSS defined the stories and their grouping in `story-map.md`; DISTILL
      wrote one acceptance `.feature` per story; DELIVER maps one roadmap step per scenario
- [x] Render-equivalence is asserted as a self-contained in-test pre-vs-post
      property (story 02); no golden snapshot of existing/seeded relations exists,
      since there is no legacy/production View/Report data

---

## Wave Outputs (file paths)

* `tests/acceptance/normalize-view-report-operations/report-typed-kernel.feature` (3; `@boundary_validation @pending`)
* `tests/acceptance/normalize-view-report-operations/kernel-visitor-renderer.feature` (3; `@renderer_consolidation @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-filters-normalized.feature` (5; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-columns-normalized.feature` (4; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-joins-normalized.feature` (3; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-grain-normalized.feature` (3; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-aggregations-normalized.feature` (4; `@component_normalized @report_rules @pending`)
* `tests/acceptance/normalize-view-report-operations/drop-embedded-json-columns.feature` (2; `@contract_migration @pending`)
* `tests/acceptance/normalize-view-report-operations/conftest.py` (real engine + SAVEPOINT rollback + `repository_container` + `auth_context` fixtures)
* `tests/acceptance/normalize-view-report-operations/steps/relation_steps.py` (Capture dataclass; milestone `pytest.fail` scaffolds)
* `tests/acceptance/normalize-view-report-operations/steps/__init__.py`
* `tests/acceptance/normalize-view-report-operations/pyproject.toml` + `uv.lock`
* `tests/acceptance/normalize-view-report-operations/test_*.py` (8 pytest-bdd runners)
* `docs/feature/normalize-view-report-operations/distill/{wave-decisions.md,upstream-issues.md}` (this + sibling)

(No `deliver/roadmap.json` is produced by DISTILL — the roadmap is a **DELIVER**
artifact, generated later by `nw-deliver`.)

---

## Hand-off to DELIVER (nw-software-crafter)

**Next wave:** DELIVER. `nw-deliver` first GENERATES `deliver/roadmap.json` — a
step-per-scenario schedule — from the DISTILL acceptance suite plus the story
dependency ordering surfaced here; then each roadmap step is delivered as its own
**scenario** issue via `/nw-execute` (the current linear-cyrus codegen unit; one
scenario branch → squash into the feature branch). The product owner directs a RED
acceptance test per scenario as the gate. Together the scenarios implement the
typed projection kernel, the kernel visitor + render catalog, the five
`relation_*` component tables + shared repository + polymorphic cascade, and the
expand/contract migrations via Outside-In TDD, enabling milestone scenarios one at
a time.

**Input package for DELIVER (`nw-deliver` reads these to generate the roadmap):**
* This file — OQ resolutions, adapter coverage, mandate compliance, and the story
  dependency ordering (03 is the pattern-prover for 04–07; 08 is the contract
  half) that the generated roadmap must encode
* `discuss/story-map.md` — the Release-Slice → story grouping (a slice groups
  one-or-more stories)
* `slices/` — the per-slice briefs
* The 8 `.feature` files — scenario SSOT; the roadmap carries one step per scenario
* The DISTILL scaffolds — DELIVER replaces the `pytest.fail` milestone step bodies
  with real implementations
* ADR-052 (Proposed) + `design/*` + `discuss/*` — governing, unchanged

**Render-equivalence reminder:** render-equivalence is a self-contained in-test
pre-vs-post property (story 02: the consolidated renderer produces the same SQL as
the separate compilers for the same in-test relation). There is no golden snapshot
of existing/seeded relations and no characterization gate, because there is no
legacy/production View/Report data and View/Report are display-only. If a later
story drifts the equivalence, the change is wrong (Iron Rule).

**OQ-4** (polymorphic-cascade enforcement mechanism: repo path + CHECK vs
trigger) is routed to DELIVER, to be resolved with the story 03 migration; the
story 03 `@polymorphic_cascade` acceptance scenario pins the observable outcome
and is mechanism-agnostic.
