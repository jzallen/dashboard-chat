<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — `normalize-view-report-operations` — DISTILL

**Feature:** normalize-view-report-operations
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-07-24
**Author:** Quinn (nw-acceptance-designer)
**Linear:** DC-78 (stories DC-80..DC-88)
**Prior waves:** DISCUSS (stories + 9-slice carpaccio, validated) · DESIGN (ADR-052 Proposed, domain-model Option B, C4, wave-decisions, validated)

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

DISCUSS (`user-stories.md`, `story-map.md`, `prioritization.md`,
`wave-decisions.md`) and DESIGN (`domain-model.md`, `c4-component.md`,
`wave-decisions.md`, ADR-052) are internally consistent and consistent with each
other. DISCUSS defined the 9 carpaccio slices (00–08) and their story grouping in
`story-map.md` — a Release Slice groups one or more stories, not inherently 1:1 —
tracking to Linear stories DC-80..DC-88. Every ADR-052 acceptance
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

* **[DWD-1] Walking-skeleton strategy: C-local — real SQLAlchemy + in-memory
  SQLite + real ibis→DuckDB SQL rendering, no compose stack.** The walking
  skeleton IS slice 00 (DC-80): the render-equivalence characterization
  snapshot. Every seeded view/report is persisted through the real repository
  adapter (`RepositoryContainer.metadata.create_view` / `create_report` against
  an aiosqlite engine — the same substrate `backend/tests/conftest.py` uses) and
  rendered to DuckDB SQL through the real compilers
  (`ViewIbisCompiler.generate_executable` / `ReportIbisCompiler.generate_executable`
  → `ibis.to_sql(dialect="duckdb")`). Both driven adapters that matter for
  render-equivalence — the SQLAlchemy/SQLite persistence adapter AND the ibis
  renderer — are exercised for real. Tagged `@walking_skeleton @real-io
  @characterization`. **Litmus test:** if the SQLite adapter or the ibis
  renderer were swapped for a stub, the snapshot would silently pass and prove
  nothing about the refactor's wiring — so the skeleton is testing real wiring,
  not an InMemory double (Mandate 6). No `@requires_external` markers: there is
  no costly external in scope.

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
  1:1 (not one row per grain key). The Phase 06 acceptance scenario "The backfill
  produces exactly one grain row per relation" pins this cardinality. Recorded
  per the DISCUSS routing (OQ-3 → DISTILL, slice 06).

* **[DWD-4] Expand/contract migration discipline is a first-class acceptance
  concern, split across phases.** Each `relation_*` slice (03–07) ships the
  EXPAND half (create table + backfill + write-both/read-rows) with the JSON
  column RETAINED that release; slice 08 ships the CONTRACT half (drop columns)
  gated behind ONE production release of 03–07. Joins backfill by array position,
  not `created_at` (ADR-052 decision 5; Phase 05 scenario "The backfill assigns
  join sequence from array position not creation time" pins it). The contract
  slice (08) is `@infrastructure` / `@contract_migration` and carries a rollback
  scenario (re-add + re-backfill). DISTILL surfaces the ordering constraint for
  DELIVER to encode: the DELIVER roadmap must order slice 08 after slices 03–07
  and behind the one-release gate.

* **[DWD-5] Characterization-gate-before-renderer-merge is a HARD dependency
  DISTILL surfaces for the DELIVER roadmap.** Slice 00 (the render-equivalence
  snapshot) must BLOCK slice 02 (the kernel-visitor renderer consolidation). The
  ordering DISTILL surfaces for `nw-deliver` to encode into the roadmap: slice 00
  before slices 01 and 02; slice 02 before slices 03–07; and a manual-review gate
  requiring the slice 00 snapshot green + pinned before the renderer merge begins.
  This is the brownfield walking-skeleton rule from ADR-052 Consequences
  ("mitigated by a characterization test pinning byte-identical SQL before the
  merge") made executable: every renderer/persistence slice (02–08) re-runs the
  snapshot as its outer safety net.

* **[DWD-6] Polymorphic-cascade enforcement (OQ-4) is ESTABLISHED in Phase 03
  and routed to DELIVER for the mechanism choice.** OQ-4 (repository delete path
  + `parent_type` CHECK vs DB trigger) is a DELIVER-with-the-migration decision
  per DESIGN's routing — DISTILL does not pre-decide the mechanism. But the
  BEHAVIOR it must produce is pinned by acceptance scenarios now: Phase 03's
  "Deleting a relation removes only its own filter rows" + "the other relation's
  filter rows remain intact" (tagged `@polymorphic_cascade`) is the P5 probe made
  executable. The recommended mechanism (repo delete path + CHECK) is surfaced for
  DELIVER to weigh at the slice 03 migration; the acceptance scenario is agnostic to the
  mechanism and asserts only the observable cascade outcome, so DELIVER may
  choose trigger-vs-repo-path without a test rewrite.

* **[DWD-7] Nine feature files, 30 scenarios, one file per phase.** One
  walking-skeleton feature (3 characterization scenarios, Phase 00) + eight
  milestone features (Phases 01–08) grouping the phase's scenarios. Per-file
  counts: 00 render-characterization = 3; 01 report-typed-kernel = 3; 02
  kernel-visitor-renderer = 3; 03 relation-filters = 5; 04 relation-columns = 4;
  05 relation-joins = 3; 06 relation-grain = 3; 07 relation-aggregations = 4; 08
  drop-json = 2. Total **30 scenarios** (3 WS + 27 milestone). This is at the
  upper end of the recommended 2–3 WS + 15–20 focused range because the feature
  legitimately spans five normalized component tables + a renderer consolidation
  + a boundary-typing lift + a contract migration — nine independently-shippable
  slices, each with its own learning hypothesis.

* **[DWD-8] Error/edge coverage: 13 of 30 scenarios (43%).** Exceeds the 40%
  floor. Counted as error/edge anything whose observable outcome is a
  rejection, a negative invariant (reorder-invariance), a cascade-only-own-rows
  assertion, a mart-to-mart/dimensionless rejection, or a drift-detection:
    - **Boundary rejections (4):** unknown semantic_role, illegal role/type pair
      (Phase 01); measure-without-dimension, mart-to-mart (Phase 07).
    - **Reorder-invariance negatives (5):** filters reorder → SQL unchanged
      (03); columns reorder + position change → SQL unchanged (04); grain keys
      reorder → SQL unchanged (06); aggregations reorder → SQL unchanged (07).
    - **Cascade / tenant (2):** delete removes only own rows + others intact
      (03); org-scoped filter load (03).
    - **Drift / completeness (2):** deliberate SQL change fails with per-relation
      diff (00); unhandled discriminator fails the build (02).

* **[DWD-9] Default test filter: `-m "not pending"`.** The walking-skeleton
  characterization runs by default; every slice 01–08 milestone feature is tagged
  `@pending` at the Feature level and is unpended one scenario at a time by DELIVER
  as the DELIVER roadmap (generated by `nw-deliver`) schedules each scenario.
  Mirrors the sibling `refactor-metadata-repository-split`
  suite and every other `tests/acceptance/` suite.

* **[DWD-10] Mandate-7 RED scaffolds: WS steps wired real; milestone steps use
  `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`; the one
  not-yet-existing production module the WS imports is a `__SCAFFOLD__ = True`
  module raising `AssertionError("Not yet implemented — RED scaffold")`.** The
  walking-skeleton step glue is fully wired (it seeds real relations through the
  driving port and renders through the real compilers) so the WS is
  RED-**by-assertion** at the production characterization harness
  (`app.use_cases.relation.render_characterization`), not BROKEN by an import or
  collection error — verified by running it (see §Walking-skeleton run status).
  The milestone step bodies use `pytest.fail` for cleaner reporter output
  (matching the sibling suite's DWD-9 convention). Only ONE production scaffold
  module was created — `render_characterization.py` — because it is the only
  not-yet-existing module the ACTIVE (non-pending) steps import. The
  kernel-visitor / render-catalog / typed-projection / shared-component-repository
  modules the milestone slices will introduce are imported only inside `@pending`
  milestone step bodies that `pytest.fail` before importing, so scaffolding them
  now would be premature; DELIVER creates them at their slices. Existing modules
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
(and, from Phase 02, the kernel visitor) via the production characterization
harness. `@when` steps import ONLY from `app.use_cases.*` / `app.repositories`
(the container) — never a driven adapter (`ViewRecord`, `ReportRecord`, the
`relation_*` records, the shared component repository).

| Behaviour / AC | Driving port | Observable outcome |
|---|---|---|
| Render-equivalence snapshot (AC1, AC2, P2) — Phase 00 | `RepositoryContainer.metadata` + `render_characterization` harness (real compilers) | Non-empty DuckDB SQL pinned per relation; deliberate change → per-relation diff; deterministic re-run |
| Report boundary rejection (AC4, P4) — Phase 01 | `create_report` use-case function | Structured `Failure`/422 on unknown `semantic_role` / illegal role-type pair; nothing persisted; every existing report hydrates |
| Renderer consolidation (AC1, AC2, AC5, P1, P2) — Phase 02 | Kernel visitor + report extension via the harness | Snapshot byte-identical; unhandled discriminator fails build; entity-only report renders via shared path |
| relation_filters normalized (AC6, AC7, P5) — Phase 03 | `RepositoryContainer.metadata` (create/update/delete view) | Single-row INSERT; backfill 1 row per JSON element; reorder → SQL unchanged; delete cascades only own rows; org-scoped load |
| relation_columns normalized (AC2, AC6, AC7) — Phase 04 | `RepositoryContainer.metadata` (view + report) | Cross-role query returns both roles; reorder/position → SQL unchanged; single-row INSERT; snapshot byte-identical |
| relation_joins normalized (AC2, AC3, AC7, P2, P3) — Phase 05 | `RepositoryContainer.metadata` (create/update view) + harness | Swapped sequence → SQL differs; sequence-order read → snapshot byte-identical; backfill by array position |
| relation_grain normalized (AC2, AC7) — Phase 06 | `RepositoryContainer.metadata` (create/update view) | Grain keys queryable as rows; reorder → SQL unchanged; exactly one row per parent |
| relation_aggregations + report rules (AC2, AC4, AC6, AC7) — Phase 07 | `create_report` use-case + shared composition service | measure-requires-dimension over typed rows; no-mart-to-mart via composition service; single aggregation row; reorder → SQL unchanged |
| Drop-JSON contract (AC2) — Phase 08 | Migration (up/down) + harness | JSON columns dropped; snapshot byte-identical; rollback re-adds + re-backfills |

Every "Observable outcome" cell asserts on a return value from the driving port
or a user-visible signal (rendered SQL string, raised structured `Failure`,
row-count delta, cascade outcome). Zero internal-state assertions, zero
`mock.called` assertions.

---

## Adapter Coverage Table (Mandate 6)

| Driven adapter | `@real-io` scenario | Covered by |
|---|---|---|
| SQLAlchemy/aiosqlite persistence (`RestrictedSession` + in-memory SQLite) | YES | walking-skeleton (real seed of view + report); every milestone phase re-uses the same fixture |
| ibis → `to_sql(dialect="duckdb")` renderer (`ViewIbisCompiler` / `ReportIbisCompiler`) | YES | walking-skeleton (renders both seeded relations for real); Phases 02, 05, 08 re-render for snapshot equivalence |
| `RepositoryContainer.metadata` view/report persistence surface (`create_view`/`create_report`) | YES | walking-skeleton (constructs + invokes `.metadata.create_view`/`create_report`) |
| Shared `relation_*` component-table repository (Phase 03+) | Deferred to DELIVER phase | Phase 03 pattern-prover scenarios (`@pending`) exercise its real read/write/cascade once implemented; the module is a RED scaffold DELIVER creates at Phase 03 |
| Expand/contract migration (Alembic) | Deferred to DELIVER phase | Phase 03–08 backfill/drop/rollback scenarios (`@pending`) exercise the real migration once written |

The walking-skeleton `@real-io` scenario covers the two adapters that carry
render-equivalence (persistence + ibis). The component-table repository and the
migrations do not exist yet (they are the refactor's product); their `@real-io`
coverage lives in the `@pending` milestone scenarios that DELIVER unpends as each
adapter is built — InMemory doubles cannot catch the wiring, path-resolution, or
SQL-format bugs those scenarios target, so every one drives the real substrate.

**Costly-external pattern:** none in scope. In-process aiosqlite + in-process
ibis; no `@requires_external` markers.

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary).** All `@when`/`@given` step bodies in
  `steps/relation_steps.py` reach the system through `RepositoryContainer`
  (`.metadata`) and the `create_view` / `create_report` use-case functions and
  the production `render_characterization` harness. Zero imports of `ViewRecord`,
  `ReportRecord`, any `relation_*` record, or the shared component repository in
  the step module. `grep -n "import" steps/relation_steps.py` shows only
  `app.repositories.metadata` for the Org/Project SEED prerequisites
  (`OrganizationRecord`, `ProjectRecord` — background setup, not the behavior
  under test, seeded on the raw `db_session` fixture) and the public use-case /
  harness entry points inside `@when` bodies.

* **CM-B (Business language).** Gherkin uses domain terms only: "engineer",
  "modeler", "operator", "view", "report", "relation", "column", "filter",
  "join", "grain", "measure", "dimension", "aggregation", "tenant", "snapshot",
  "renderer". Zero technical jargon in `.feature` files: no "API", "HTTP",
  "JSON payload", "POST", "SQLAlchemy", "ibis", "Pydantic", "DuckDB", "422",
  "table", "row", "SELECT" as Gherkin verbs (those live in step defs and
  comments only). "relation", "column", "filter", "join", "grain", "measure",
  "aggregation", "snapshot" are the ubiquitous language of this refactor's
  domain (established in `domain-model.md` §3), and the user for this suite IS the
  backend engineer/modeler — their working vocabulary is domain language.

* **CM-C (User journey completeness / walking skeleton).** The walking skeleton
  frames a complete engineer journey: seed representative relations → render them
  → pin the SQL → detect drift → confirm determinism. Each milestone scenario
  frames a mini-journey: seed the precondition → act through the driving port →
  observe the outcome (rejection, row delta, invariant, cascade, snapshot
  equivalence). Counts: 3 WS + 27 focused = 30.

* **CM-D (Pure function / typed-kernel extraction inventory).** The refactor
  extracts pure typed value objects and pure render steps: `ProjectionColumn` /
  `Measure` discriminated unions (Phase 01, pure validation over
  `semantic_role`); the kernel visitor's per-component render steps (Phase 02,
  pure functions of persisted component state → ibis expression); the no-mart-to-mart
  check promoted to a pure method on the shared composition service (Phase 07).
  These are exercised indirectly through the driving-port scenarios (boundary
  rejection, render-equivalence) and will carry direct unit tests in DELIVER's
  inner loop. The render is a pure function of persisted state (AC1) — the whole
  characterization skeleton is the proof.

---

## Self-Review Checklist (Mandate 7 + critique dimensions)

- [x] WS strategy declared (DWD-1 = C-local render-equivalence)
- [x] WS scenario tagged `@walking_skeleton @real-io`
- [x] WS is RED-by-assertion, not BROKEN — verified by running it (fails at the
      `render_characterization` scaffold `AssertionError`, after real seeding +
      real container construction succeed)
- [x] Every render-carrying driven adapter has a `@real-io` scenario (table above);
      not-yet-built adapters' `@real-io` coverage is in the `@pending` phase scenarios
- [x] All milestone step bindings have RED-ready scaffolds with self-documenting
      `pytest.fail("DISTILL scaffold — DELIVER implements: ...")` markers
- [x] The one not-yet-existing production module the ACTIVE steps import is a
      `__SCAFFOLD__ = True` module raising `AssertionError("Not yet implemented — RED scaffold")`
- [x] No existing production module re-scaffolded (compilers, container, use cases, exceptions REUSED)
- [x] Error/edge coverage ≥ 40% (DWD-8: 43%)
- [x] BDD star-import after `sys.path` manipulation carries `# noqa` markers (conftest.py)
- [x] `@when` step glue imports nothing from driven adapters (CM-A)
- [x] Mandate 1 (CM-A): steps drive `RepositoryContainer` + use-case functions only
- [x] Mandate 2 (CM-B): zero technical terms in `.feature` files
- [x] Mandate 3 (CM-C): 3 WS + 27 focused = 30 scenarios
- [x] Mandate 4 (CM-D): typed-kernel + pure-render-step extraction inventory recorded
- [x] OQ-2 (report_type = label) + OQ-3 (grain 1:1) resolved and recorded (DWD-2, DWD-3)
- [x] Characterization-gate-before-renderer-merge surfaced as an ordering constraint for the DELIVER roadmap (DWD-5)
- [x] DISCUSS defined the 9 slices and their story grouping in `story-map.md` (a slice groups one-or-more stories); DISTILL wrote one acceptance `.feature` per slice; DELIVER will map roadmap steps to scenarios
- [x] Iron Rule honoured: the Phase 00 snapshot is a characterization net; a later
      phase that drifts it means the change is wrong, never re-pin the snapshot

---

## Wave Outputs (file paths)

* `tests/acceptance/normalize-view-report-operations/render-sql-characterization-snapshot.feature` (3; `@walking_skeleton @real-io @characterization`)
* `tests/acceptance/normalize-view-report-operations/report-typed-kernel.feature` (3; `@boundary_validation @pending`)
* `tests/acceptance/normalize-view-report-operations/kernel-visitor-renderer.feature` (3; `@renderer_consolidation @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-filters-normalized.feature` (5; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-columns-normalized.feature` (4; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-joins-normalized.feature` (3; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-grain-normalized.feature` (3; `@component_normalized @pending`)
* `tests/acceptance/normalize-view-report-operations/relation-aggregations-normalized.feature` (4; `@component_normalized @report_rules @pending`)
* `tests/acceptance/normalize-view-report-operations/drop-embedded-json-columns.feature` (2; `@contract_migration @pending`)
* `tests/acceptance/normalize-view-report-operations/conftest.py` (real engine + SAVEPOINT rollback + `repository_container` + `auth_context` fixtures)
* `tests/acceptance/normalize-view-report-operations/steps/relation_steps.py` (Capture dataclass; WS wired real; milestone `pytest.fail` scaffolds)
* `tests/acceptance/normalize-view-report-operations/steps/__init__.py`
* `tests/acceptance/normalize-view-report-operations/pyproject.toml` + `uv.lock`
* `tests/acceptance/normalize-view-report-operations/test_*.py` (9 pytest-bdd runners)
* `backend/app/use_cases/relation/__init__.py` + `render_characterization.py` (Mandate-7 RED scaffold)
* `docs/feature/normalize-view-report-operations/distill/{wave-decisions.md,upstream-issues.md,walking-skeleton.md}` (this + siblings)

(No `deliver/roadmap.json` is produced by DISTILL — the roadmap is a **DELIVER**
artifact, generated later by `nw-deliver`.)

---

## Hand-off to DELIVER (nw-software-crafter)

**Next wave:** DELIVER. `nw-deliver` first GENERATES `deliver/roadmap.json` — a
step-per-scenario schedule — from the DISTILL acceptance suite plus the slice
dependency ordering surfaced here; then each roadmap step is delivered as its own
**scenario** issue via `/nw-execute` (the current linear-cyrus codegen unit; one
scenario branch → squash into the feature branch). Together the scenarios implement
the render-characterization harness, the typed projection kernel, the kernel visitor +
render catalog, the five `relation_*` component tables + shared repository +
polymorphic cascade, and the expand/contract migrations via Outside-In TDD,
enabling milestone scenarios one at a time as the generated roadmap schedules them.

**Input package for DELIVER (`nw-deliver` reads these to generate the roadmap):**
* This file — WS strategy, OQ resolutions, adapter coverage, mandate compliance,
  and the slice dependency ordering (00 gates 02; 03 is the pattern-prover for
  04–07; 08 is the contract half) that the generated roadmap must encode
* `discuss/story-map.md` — the Release-Slice → story grouping (a slice groups
  one-or-more stories)
* `slices/` — the per-slice briefs
* `walking-skeleton.md` — notes on the render-equivalence characterization skeleton
* The 9 `.feature` files — scenario SSOT (the WS feature is the render-equivalence
  SSOT); the roadmap will carry one step per scenario
* The DISTILL scaffolds — DELIVER replaces the `pytest.fail` milestone step bodies
  and the `render_characterization` `AssertionError` scaffold with real implementations
* ADR-052 (Proposed) + `design/*` + `discuss/*` — governing, unchanged

**HARD GATE reminder:** slice 00 (render-equivalence snapshot) MUST be green and
pinned before slice 02 (renderer consolidation) begins (DWD-5). Every
renderer/persistence slice (02–08) re-runs the snapshot as its outer safety net —
if it drifts, the change is wrong, not the snapshot (Iron Rule).

**OQ-4** (polymorphic-cascade enforcement mechanism: repo path + CHECK vs
trigger) is routed to DELIVER, to be resolved with the slice 03 migration; the
slice 03 `@polymorphic_cascade` acceptance scenario pins the observable outcome
and is mechanism-agnostic.
