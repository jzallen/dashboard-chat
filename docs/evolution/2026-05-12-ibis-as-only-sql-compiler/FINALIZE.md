# Finalize — `ibis-as-only-sql-compiler`

> **Feature shipped**: 2026-05-12 (all five phases / MRs).
> **Wave path**: DESIGN → DISTILL → DELIVER → FINALIZE. DISCUSS / DIVERGE /
> DISCOVER intentionally skipped per CLAUDE.md brownfield routing
> (refactoring with ratified ADR enters at DISTILL).
> **Design ratification**: [ADR-026](../../decisions/adr-026-ibis-as-only-sql-compiler.md)
> Accepted 2026-05-11 (merge `ef65252`, underlying commit `b375dea`).
> **Branch (finalize)**: `finalize/ibis-as-only-sql-compiler`.
> **Archived artifacts**: this directory (`distill/`, `deliver/`) is the
> verbatim DELIVER-end snapshot of the feature workspace.
> **Source workspace**: `docs/feature/ibis-as-only-sql-compiler/` (preserved
> pending human review — see [§Workspace cleanup](#workspace-cleanup) for the
> recommendation).

---

## 1. Summary

The SQL-compilation surface is now **ibis end-to-end across all four
mutable tiers** — staging, view, report, and dbt intermediate — with the
lake-repository layer hardened by consistent `quote_ident()` hygiene. The
parallel-compiler hazard between `model_sql.py` (dbt staging emission) and
`dataset_sql.py` (ibis staging emission) is closed: `dataset_sql` is the
single source of staging-tier SQL truth, and `model_sql` is now a thin
orchestrator that renders the same ibis Table through a
`{{ source(...) }}`-emitting compiler subclass.

The three determinism gaps the research doc named are all closed:

| Gap | Location (legacy) | Closure mechanism | Where |
|---|---|---|---|
| **Gap 1** — view-tier SQL injection vector | `backend/app/use_cases/view/sql_generator.py:160` (f-string WHERE) | ibis literal escaping — `f.value` flows through `table.filter(table.col == value)` expressions, never through string interpolation | Phase 01 / MR-1 |
| **Gap 2** — freeform SQL in report tools | `agent/lib/chat/reportToolDefinitions.ts:53-78` (`createReport.sqlDefinition`) + `backend/app/use_cases/report/create_report.py:24,77` (`sql_definition: str`) | Structured composition through `ReportIbisCompiler` consuming dimensions / measures; `sqlDefinition` removed from agent tool schema; `sql_definition` parameter rejected with `DeprecatedSqlDefinitionField` at the use-case boundary | Phase 03 / MR-3 |
| **Gap 3** — lake-repo `quote_ident` hygiene | `backend/app/repositories/lake/repository.py:214-247` (preview / count / typeof), `:266-277` (cleaning-transform preview) | `quote_ident()` applied consistently for every column-name interpolation in the lake layer | Phase 04 / MR-4 |

ADR-026's binding contracts (4 items in §"Decision outcome") all hold in
the shipped code, verified against `origin/main` HEAD as part of this
finalize wave:

* Tier-by-tier ibis adoption (staging already ibis-compiled per ADR-007;
  view + report + intermediate now ibis-compiled).
* dbt macro emission via ibis-source plugin (no post-render regex).
* No backfill / no grandfather / no flag-gate for legacy report SQL
  (pre-production codebase — one-time migration clears any existing
  raw-SQL report rows; new calls are rejected).
* No free-text `expr` escape hatches on `addDimension` / `addMeasure`
  (removed from agent tool schema entirely; future semantic computations
  land as typed `ComputedField` discriminated-union variants).

`ViewSQLGenerator` survives as a thin deprecation shim that delegates to
`ViewIbisCompiler` and emits `DeprecationWarning` — one release of
overlap so callers (controllers, dbt-eject intermediate model wrapper,
`update_view` use case) can switch incrementally. Per ADR-026 §"MR
roadmap" → MR-1 row and the source research doc §"First MR shape", the
shim is documented for removal in a subsequent cleanup MR.

---

## 2. Phase-by-phase outcome

### Phase 01 — MR-1 `ViewIbisCompiler` replaces `ViewSQLGenerator` (closes Gap 1)

**Shipped commits on `main`**:
- `fdc8e1e` — `feat(backend/models): ViewFilter as Pydantic discriminated union (ADR-026 MR-1)`
- `b0e9567` — `feat(tests/acceptance/ibis-as-only-sql-compiler): scaffold suite + step glue for milestone-1 (ADR-026 MR-1)`
- `21fda79` — `feat(backend/use_cases/view): ViewIbisCompiler replaces ViewSQLGenerator (ADR-026 MR-1)`
- `49981a2` — `feat(distill): unpend walking-skeleton + milestone-1 scenarios (ADR-026 MR-1)`
- `a77c56c` — `chore(distill): flip Phase 01 status = completed in roadmap.json`
- `a07777a` — merge of `feat/adr-026-mr-1-view-ibis-compiler` into `main`

**What changed**:

* `backend/app/models/view.py`: `ViewFilter` becomes a Pydantic
  discriminated union over `operator` (per-operator value typing — `str`
  for comparisons / `LIKE`, `list[str]` for `IN` / `NOT IN`, `None` for
  `IS NULL` / `IS NOT NULL`). `ViewColumn` and `ViewJoin` become
  Pydantic models with compatible `serialize` / `from_record` surface.
* `backend/app/use_cases/view/sql_generator.py`: `ViewIbisCompiler`
  consumes the same `View` domain object and emits SQL through
  `ibis.to_sql(dialect="duckdb")`. The CAST/FROM/JOIN clauses move onto
  the same compiler so the view tier is ibis end-to-end. The legacy
  `ViewSQLGenerator` is retained as a thin deprecation shim that
  delegates to `ViewIbisCompiler` and emits `DeprecationWarning`.
* `backend/app/use_cases/view/create_view.py`: `_parse_filters` converts
  Pydantic `ValidationError` into `InvalidViewFilter(_status_code=400)`
  so malformed operators surface as a structured 4xx with a named
  rejected field rather than a generic 500.
* `tests/acceptance/ibis-as-only-sql-compiler/`: new acceptance suite
  scaffold (pyproject.toml + uv.lock + conftest.py + driver.py +
  step-glue) — per DWD-2 it is a NEW suite, not an extension of
  `tests/acceptance/dbt-test-validation/`.
* `backend/tests/use_cases/view/test_sql_generator.py`: existing
  byte-shape unit tests rewritten at L2 (contract-mirroring per
  `nw-test-refactoring-catalog`) — assertions target customer-visible
  outcomes rather than the f-string compiler's exact text. A new
  `TestInjectionVectorClosure` regression class covers Gap 1 directly:
  a hostile value containing single quotes appears in the rendered SQL
  as an SQL-escaped literal (`''`) and the SQL's quote count stays
  even, so the WHERE clause cannot be terminated by the payload.

**Acceptance scenarios unpended**: walking-skeleton + 5 milestone-1
scenarios (`structure`, `injection`, `operators` (Scenario Outline, 12
example rows), `dbt-eject equivalence`, `malformed operator`).

### Phase 02 — MR-2 dbt intermediate ibis-source plugin (replaces post-render regex)

**Shipped commits on `main`**:
- `f7a6363` — `test(intermediate): characterization tests for dbt-ref macro emission (ADR-026 MR-2 prep)`
- `ada7c0a` — `refactor(intermediate): ibis-source plugin replaces post-render dbt-ref regex (ADR-026 MR-2)`
- `03a1cdf` — `chore(deliver): track Phase 02 wave artifacts (roadmap + DES execution log)`

**What changed**:

* `backend/app/use_cases/project/_dbt/ibis_dbt_source.py`: new module
  containing `IbisDbtRefDuckDBCompiler` — a `DuckDBCompiler` subclass
  whose `visit_UnboundTable` emits `{{ ref('<model>') }}` macros
  directly during sqlglot serialization, replacing the post-render
  `sql.replace(ref_id, "{{ ref('...') }}")` substitution at
  `intermediate.py:34-38`.
* `backend/app/use_cases/project/_dbt/intermediate.py`: drops the
  post-render regex; calls into the new ibis-source plugin.
* `backend/tests/use_cases/project/_dbt/test_intermediate_dbt_ref_characterization.py`:
  characterization tests authored FIRST (Feathers brownfield practice
  per CLAUDE.md) covering parameterized dbt-ref macro emission shapes.
* `ViewSQLGenerator.generate_executable(view, ref_mode=True)` no longer
  invokes a post-render `_rewrite_sources_to_dbt_refs` regex — it
  delegates to the ibis-source plugin (the helper has been removed from
  `sql_generator.py` entirely).

**Acceptance scenarios unpended**: none new — the walking-skeleton
dbt-eject scenario + milestone-1 dbt-eject-equivalence scenario from
Phase 01 cover the customer-visible invariant.

### Phase 03 — MR-3 `ReportIbisCompiler` + dispatcher wiring + `sqlDefinition` removal (closes Gap 2)

**Shipped commits on `main`**:
- `6c81978` — `feat(backend): introduce ReportIbisCompiler for structured report SQL (MR-3)`
- `f1f3ffa` — `feat(backend): extend ReportIbisCompiler for multi-dim multi-measure composition`
- `9953eb1` — `refactor(backend): rip out sql_definition input from create_report (MR-3)`
- `ddddca7` — `feat(backend): reject reports with measures but no dimensions (MR-3)`
- `fd00fa7` — `refactor(agent): drop sqlDefinition + expr from report tool schemas (MR-3)`
- `8b07ecc` — `chore(deliver): record Phase 03 deliver wave artifacts for MR-3`

**What changed**:

* `backend/app/use_cases/report/report_ibis_compiler.py`: new module
  implementing structured composition. Consumes the report's
  `columns_metadata` (dimensions + measures) and emits SQL via
  `ibis.Table.group_by(dims).aggregate(measures)` rendered through
  `ibis.to_sql(dialect="duckdb")`. Covers all six measure
  `semantic_type` values (`sum` / `count` / `count_distinct` / `avg` /
  `min` / `max`), multi-dim GROUP BY ordering, multi-measure on the
  same source column with distinct aliases, and embedded-quote literal
  handling.
* `backend/app/use_cases/report/create_report.py`: `sql_definition`
  parameter rejected with a structured `DeprecatedSqlDefinitionField`
  exception (raised FIRST — before any DB / dependency work — so the
  rejection path has zero side effects per DWD-5 boundary choice). The
  use case now accepts `columns_metadata`, derives the SQL through
  `ReportIbisCompiler`, and persists the result back into the
  (renamed-for-storage) `sql_definition` column.
* New `ReportRequiresDimension` exception: raised AFTER semantic-role
  validation but BEFORE compiler invocation when `columns_metadata`
  contains measures but no dimensions. Modeling-violation rejection per
  the milestone-2 §3 contract.
* `agent/lib/chat/reportToolDefinitions.ts`: `createReport.sqlDefinition`
  removed from the tool schema (verified by grep: the only remaining
  mention is a comment noting the field is REMOVED). `addDimension.expr`
  and `addMeasure.expr` free-text fields removed. `.strict()` applied at
  the schema layer so unknown fields are rejected as schema violations.
* One-time migration: pre-production codebase per ADR-026 §"Decision
  outcome" item 2 — no backfill, no grandfather, no flag-gate; the
  migration clears any existing report rows whose persisted SQL was
  authored as raw text.

**Acceptance scenarios unpended**: 5 milestone-2 scenarios
(`aggregation`, `deprecation-contract`, `modeling-violation`,
`composition`, `schema-violation` at the agent's Zod-parse layer).

**Out-of-scope deferral**: per [DI-2](#deferred-items), the planned Step
03-06 backend `addDimension` / `addMeasure` dispatcher use cases were
deferred to a follow-up MR-3.5 — the milestone-2 acceptance contract is
fully observable through steps 03-01..03-05.

### Phase 04 — MR-4 lake-repo `quote_ident` hygiene (closes Gap 3)

**Shipped commits on `main`**:
- `b737f4f` — `fix(backend): quote_ident on lake-repo column-type query (ADR-026 MR-4)` (crew worker `chisel`)
- `4599668` — `chore(deliver): record DES COMMIT phase + progress tracker for step 04-01`

**What changed**:

* `backend/app/repositories/lake/repository.py`: every column-name
  interpolation in the preview / count / typeof / cleaning-transform
  preview SQL paths now flows through `quote_ident()`. The
  `s3_path`-only f-strings remain (s3_path comes from internal config,
  not user input) but every `column` / `target_column` parameter is
  quoted at the boundary.
* `backend/tests/repositories/lake/test_repository.py`: characterization
  tests added for column names containing edge characters (embedded
  double quotes). Test name `test_doubles_embedded_double_quotes`
  served as the port-level RED test under legacy behavior per the
  Phase 04 execution-log RED_ACCEPTANCE note.

**Acceptance scenarios unpended**: none — internal-only hygiene, no
customer-facing surface change. Existing repository unit tests cover it.

### Phase 05 — MR-5 `model_sql.py` reconciliation (eliminates parallel-compiler hazard)

**Shipped commits on `main`**:
- `f4a52f3` — `chore(deliver): scaffold Phase 05 deliver roadmap for ADR-026 MR-5` (crew worker `mason`)
- `2e14a5b` — `refactor(backend/_dbt): model_sql consumes ibis pipeline via dbt-source plugin (ADR-026 MR-5)` (crew worker `mason`)
- `efb4b9f` — `chore(deliver): record Step 05-01 DES phase entries`
- `0d2d801` — `chore(deliver): mark Step 05-01 complete; resolve pandera workspace note`

**What changed**:

* `backend/app/use_cases/project/_dbt/model_sql.py`: now a thin
  orchestrator that filters enabled transforms, returns a byte-faithful
  `SELECT * FROM {{ source(...) }}` passthrough when no transforms
  remain, and otherwise builds the ibis Table via
  `dataset_sql.build_ibis_table(...)` and renders it through
  `IbisDbtSourceDuckDBCompiler`. The retired per-operation
  CTE-emission helpers (`_fill_null_to_sql`, `_map_values_to_sql`,
  `_transform_to_sql`, `_case_to_sql`, `_is_numeric`,
  `_build_cleaned_cte`, `_build_alias_select`, `_get_schema_columns`)
  are gone. Net deletion in this MR.
* `backend/app/use_cases/project/_dbt/ibis_dbt_source.py`: extended
  with `IbisDbtSourceDuckDBCompiler` — same shape as
  `IbisDbtRefDuckDBCompiler` (MR-2) but `visit_UnboundTable` emits
  `{{ source('<project_snake>', '<dataset_snake>') }}` instead of
  `{{ ref('<model>') }}`. The compiler is constructed with the
  (project_snake, dataset_snake) pair — there is exactly one unbound
  source table per dbt staging model.
* `backend/tests/use_cases/project/_dbt/test_model_sql_characterization.py`:
  new parameterized characterization suite covering trim / case (all
  modes) / fill_null (text / numeric / quoted) / map_values (basic /
  quoted) / filter / alias / combined / disabled / schema-fallback /
  injection / reserved-word / cleaning-order. Per CLAUDE.md brownfield
  Feathers discipline these were authored BEFORE the production code
  changed.
* `backend/tests/use_cases/project/_dbt/test_model_sql.py`: pre-existing
  substring assertions on the `WITH source AS` / `cleaned AS` /
  `filtered AS` CTE layout were L2-rewritten to pin the
  dbt-staging-SQL contract (row-equivalence under DuckDB and the
  `{{ source(...) }}` macro position) rather than the legacy CTE byte
  shape.

**Out-of-scope file touches surfaced** (per `deliver/upstream-issues.md`):

* `backend/tests/use_cases/project/test_export_dbt_project.py` — one
  substring assertion rewritten L2-style.
* `backend/tests/use_cases/project/_dbt/test_zip_orchestrator.py` — one
  substring assertion rewritten L2-style.

Both files contained legacy-mechanism-pinning substring assertions on
the form `'TRIM("name")' in sql` that interrogated the legacy CTE
compiler's bare-string TRIM emission. After MR-5 the ibis pipeline
emits `TRIM("<alias>"."<col>", '<chars>')` — same operation, different
byte shape. The Iron Rule's never-modify-a-failing-test does NOT apply
to L1–L3 test-refactoring of pre-existing legacy-mechanism-pinning
assertions per `nw-test-refactoring-catalog`, but the touched files
were not listed in the step's `files_to_modify` — surfaced here for
transparency.

**Acceptance scenarios unpended**: none — behavior-preserving refactor
covered by the existing 11 scenarios.

---

## 3. ADR ratification

| ADR | Title | Status | Role in this feature |
|---|---|---|---|
| [ADR-026](../../decisions/adr-026-ibis-as-only-sql-compiler.md) | Ibis as the Only SQL Compiler | Accepted 2026-05-11 | **Ratified by this feature.** The 5-MR roadmap in §"MR roadmap" is the implementation contract; the 4 items in §"Decision outcome" are the binding contracts. All four hold in shipped code. |
| [ADR-007](../../decisions/adr-007-ibis-for-sql-generation.md) | Ibis for SQL generation (staging tier) | Accepted (precedent) | **Precedent ADR-026 extends.** ADR-007 ratified ibis for the staging tier; ADR-026 extends the same posture to view + report + intermediate. |
| [ADR-032](../../decisions/adr-032-service-tier-renaming.md) | Service tier renaming (reverse-proxy / ui-presentation / ui-state) | Accepted (orthogonal) | Sibling ADR landed adjacent to this feature (commit `00a6d18`); NOT part of the ibis-compiler contract surface. Listed only because it landed during the same workweek. |

ADR-026 is the load-bearing ratification; ADR-007 is the precedent it
generalizes; ADR-032 is orthogonal. No new ADRs were authored by this
feature's waves — the design ratification was complete before DISTILL
began per CLAUDE.md brownfield routing.

---

## 4. Research that drove this feature

Both research documents live at canonical paths (`docs/research/`) and
are referenced rather than copied here:

* [`docs/research/deterministic-sql-construction-architecture.md`](../../research/deterministic-sql-construction-architecture.md)
  — §1.7 (ten-path inventory), §3 (the three gaps closed by this
  feature), §5 (where agent dynamism lives — informed the dispatcher
  boundary), §6 (the 5-MR roadmap recipe).
* [`docs/research/ibis-cel-deterministic-sql.md`](../../research/ibis-cel-deterministic-sql.md)
  — the rejected CEL design alternative. Preserved because the worked
  examples in §5 (revenue-by-region report shape) are still
  load-bearing as analyst-pattern fixtures for the report tier;
  ADR-026 ratifies the ibis path while preserving these examples.

---

## 5. DELIVER execution log

The wave shipped in five sequential phases via the gastown headless
merge queue (rig: `dashboard_chat`; `merge_queue.test_command` =
`./tools/test/test.sh --backend` for Phases 01–05; the content-aware
`--auto` gate landed adjacent to this finalize wave as commit
`289308a`).

| Phase | Steps tracked in DES | Stories / Gap | Crew worker | Commits on `main` |
|---|---|---|---|---|
| 01 (MR-1 ViewIbisCompiler + ViewFilter Pydantic union) | not tracked locally | Gap 1 | (early-week — DES not yet wired for this feature) | `fdc8e1e`, `b0e9567`, `21fda79`, `49981a2`, `a77c56c`, `a07777a` |
| 02 (MR-2 dbt intermediate ibis-source plugin) | not tracked locally | n/a (refactor) | (early-week — DES not yet wired for this feature) | `f7a6363`, `ada7c0a`, `03a1cdf` |
| 03 (MR-3 ReportIbisCompiler + `sqlDefinition` rip-out) | 03-01..03-05 | Gap 2 | `azurite` | `6c81978`, `f1f3ffa`, `9953eb1`, `ddddca7`, `fd00fa7`, `8b07ecc` |
| 04 (MR-4 lake-repo `quote_ident`) | 04-01 | Gap 3 | `chisel` | `b737f4f`, `4599668` |
| 05 (MR-5 `model_sql.py` reconciliation) | 05-01 | parallel-compiler hazard | `mason` | `f4a52f3`, `2e14a5b`, `efb4b9f`, `0d2d801` |

DES phase coverage (from `deliver/execution-log.json`):

| Step | PREPARE | RED_ACCEPTANCE | RED_UNIT | GREEN | COMMIT |
|---|---|---|---|---|---|
| 03-01 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 03-02 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 03-03 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 03-04 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 03-05 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 04-01 | ✅ | SKIPPED (NOT_APPLICABLE — no new acceptance scenario for MR-4 per `distill/roadmap.json`; characterization tests at the BaseLakeRepository driving port act as the port-level RED test) | ✅ | ✅ | ✅ |
| 05-01 | ✅ | SKIPPED (NOT_APPLICABLE — behavior-preserving refactor per ADR-026 MR-5; existing walking-skeleton + milestone-1 + milestone-2 acceptance suites are the regression net) | ✅ | ✅ | ✅ |

Phases 01 + 02 lack DES tracking entirely — they shipped earlier in the
week before the per-feature DES execution log was instantiated for this
feature. The implementation is on `main` (commits enumerated above) and
the acceptance scenarios they enabled (walking-skeleton + 5 milestone-1)
are GREEN in the shipped suite at
`tests/acceptance/ibis-as-only-sql-compiler/`. This is the parallel of
the user-flow-state-machines feature's DI-4 gap; recorded as
[DI-5](#deferred-items) and treated as recoverable documentation debt
per the §[Lessons learned](#lessons-learned) §7.5 entry from that
feature.

---

## 6. Manual review gates — verification

The DISTILL roadmap (`roadmap.json` §`manual_review_gates`) defined
three review checkpoints. Each is verified below against `origin/main`
HEAD as part of this finalize wave.

### Gate 1 — after Phase 01

**Required**: Walking-skeleton + milestone-1 GREEN on real CI runner.
Injection-vector contract is the security-critical assertion; verify
ibis literal escaping is the closure mechanism (not a Pydantic `value`
validator, not a `.replace("'", "''")` defense, not a sqlglot AST pass).

**Held**:

* Walking-skeleton + 5 milestone-1 scenarios are present in the shipped
  suite at `tests/acceptance/ibis-as-only-sql-compiler/`
  (`test_walking_skeleton.py`, `test_milestone_1_structure.py`,
  `test_milestone_1_injection.py`, `test_milestone_1_operators.py`,
  `test_milestone_1_dbt_eject.py`, `test_milestone_1_malformed_operator.py`).
* `backend/app/use_cases/view/sql_generator.py` module docstring
  explicitly names the closure mechanism: "every `ViewFilter.value`
  flows through ibis literals at the expression layer, never through
  string interpolation". The only f-string remaining in the file is in
  an error-message path (`f"unsupported operator: {operator}"`) guarded
  by Pydantic `Literal`.
* No `.replace("'", "''")` strings appear in `sql_generator.py`. No
  sqlglot AST validation is introduced.

### Gate 2 — after Phase 03

**Required**: All milestone-2 scenarios GREEN. `createReport.sqlDefinition`
removed from BOTH surfaces (agent tool schema + backend use case).
Free-text `expr` fields removed from `addDimension` / `addMeasure`. No
backfill / grandfather / flag-gate.

**Held**:

* 5 milestone-2 scenarios shipped in the suite
  (`test_milestone_2_aggregation.py`, `test_milestone_2_deprecation_contract.py`,
  `test_milestone_2_modeling_violation.py`, `test_milestone_2_composition.py`,
  `test_milestone_2_schema_violation.py`).
* `agent/lib/chat/reportToolDefinitions.ts`: only mention of
  `sqlDefinition` is a comment stating the field is REMOVED. `.strict()`
  applied at the Zod schema layer rejects unknown fields. `expr` fields
  on `addDimension` / `addMeasure` are gone.
* `backend/app/use_cases/report/create_report.py`: `sql_definition`
  parameter is retained on the function signature but raises
  `DeprecatedSqlDefinitionField` immediately if supplied (line 99) —
  before any DB / dependency work — so the rejection path has zero
  side effects per DWD-5. The storage column of the same name is now
  ALWAYS derived by the compiler (line 154).
* Phase 03's one-time migration cleared any pre-production report rows
  whose persisted SQL was authored as raw text. No flag-gate, no
  backfill, no grandfather path.

### Gate 3 — after Phase 05

**Required**: Parallel-compiler hazard closed — `model_sql.py` consumes
`dataset_sql.build_staging_sql()` instead of re-deriving. All 11
acceptance scenarios GREEN. Mutation testing kill rate ≥ 80% on both
new compilers (ViewIbisCompiler, ReportIbisCompiler).

**Held (partially — mutation testing deferred)**:

* `backend/app/use_cases/project/_dbt/model_sql.py` module docstring
  describes the thin-orchestrator shape and explicitly states "DWD-4
  (hard constraint): NO `.replace("'", "''")` defenses live here. Ibis
  literal escaping IS the closure mechanism for SQL injection." The
  retired CTE-emission helpers are gone (verified by file diff against
  the legacy 208-line implementation).
* All 11 acceptance scenarios remain GREEN in the shipped suite.
* **Mutation testing kill-rate ≥ 80%** is **DEFERRED** per
  [DI-1](#deferred-items). The backend project has no mutation-testing
  tool configured (`mutmut` / `cosmic-ray` absent from
  `backend/pyproject.toml`); standing one up at MR-3 / MR-5 scope
  carries a project-wide dev-dep choice + a surviving-mutant fix cycle
  on the existing codebase. The substantive mutation-aware unit-test
  suite (e.g., the alias-rule test that catches `entry["name"]` →
  `entry["source_column"]` mutants per the commit message for
  `f1f3ffa` / Phase 03 step 03-02) is the proxy. Deferred to a
  project-wide setup MR; ReportIbisCompiler + ViewIbisCompiler are the
  natural first targets when that lands.

---

<a id="deferred-items"></a>

## 7. Deferred items / open issues

These are explicit deferred follow-ons, NOT resolved by this finalize
wave. Each is recorded with its owner and next action.

### DI-1 — Mutation testing kill-rate ≥ 80% (carried from Gate 3)

* **Where**: `backend/pyproject.toml` has no `mutmut` / `cosmic-ray`
  configuration. The `ViewIbisCompiler` and `ReportIbisCompiler` unit
  suites are mutation-aware in practice (e.g., the alias-rule test in
  `test_report_ibis_compiler.py` catches the `entry["name"]` →
  `entry["source_column"]` mutant explicitly per the Phase 03 §03-02
  commit message), but no formal kill-rate measurement was run.
* **Why deferred**: per
  [`deliver/wave-decisions-phase-03.md`](deliver/wave-decisions-phase-03.md)
  §DWD-DELIVER-3, standing up mutation testing at MR-3 scope would
  carry a project-wide dev-dep choice (mutmut vs cosmic-ray vs custom)
  plus a one-time discovery pass of surviving mutants on the existing
  codebase. None of MR-1 / MR-2 / MR-4 / MR-5 ran formal mutation
  testing against their respective ≥ 80% exit criteria either; the
  criterion is honored historically by the substantive unit-test
  suites.
* **Follow-on owner**: project-wide tooling MR.
* **Action on resolution**: add `mutmut` configuration to
  `backend/pyproject.toml`, run baseline on the codebase, then target
  `ViewIbisCompiler` + `ReportIbisCompiler` + `model_sql.py` first.

### DI-2 — Step 03-06 (backend `addDimension` / `addMeasure` dispatcher use cases) deferred to MR-3.5

* **Where**: `backend/app/use_cases/report/dispatchers/` (not yet
  created). Routes `/api/projects/{project_id}/reports/{report_id}/(dimensions|measures)`
  do not exist.
* **Why deferred**: per
  [`deliver/wave-decisions-phase-03.md`](deliver/wave-decisions-phase-03.md)
  §DWD-DELIVER-1, the milestone-2 acceptance scenarios that name
  `addDimension` / `addMeasure` (scenarios 1 and 4) exercise the
  structured `create_report` path with `columns_metadata` carrying
  dimensions + measures in a single call — they do NOT split into
  per-tool dispatcher invocations. The milestone-2 scenario that DOES
  name `addMeasure` directly (scenario 5, the `@input_surface_contract`)
  is satisfied by the agent tool-schema cleanup in step 03-05.
* **Functional impact**: zero — the agent's `addDimension` /
  `addMeasure` tools today resolve to no-op LLM tool definitions on the
  report context (the `report`-context branch of `dispatcherRegistry`
  is empty in `agent/lib/chat/dispatchers/index.ts`). MR-3 does not
  regress this; it simply does not extend it.
* **Follow-on owner**: follow-up MR (MR-3.5).
* **Action on resolution**: add backend handlers under
  `backend/app/use_cases/report/dispatchers/`, mount routes, add a
  `report`-context branch in `dispatcherRegistry` that calls them, and
  write the dispatcher unit suite at
  `backend/tests/use_cases/report/test_dispatchers.py`.

### DI-3 — Phase 4 (adversarial review) + Phase 3 (L1-L4 cross-step refactor) gates skipped in Phase 03

* **Where**: orchestrator-level review passes for the five Phase-03
  commits.
* **Why skipped**: per
  [`deliver/wave-decisions-phase-03.md`](deliver/wave-decisions-phase-03.md)
  §DWD-DELIVER-2, the headless session was wedged mid-flight after
  step 03-03 and recovered via Overseer nudge with directive "Phase 03
  implementation is essentially complete. … verify DES integrity, run
  the milestone-2 acceptance suite locally, confirm walking-skeleton +
  milestone-1 still green, then push to origin/crew/azurite and `gt mq
  submit`." Each Phase 03 commit DID run `nw-software-crafter` under
  its per-step LOCAL L1-L4 refactor pass and the backend test gate;
  only the orchestrator-level CROSS-STEP pass was skipped.
* **Functional impact**: zero observed — the merge-queue backend gate
  was GREEN at each commit's submission. Risk window: the cross-step
  refactor pass would catch shared-helper duplication across steps
  03-01..03-05; spot-check at finalize-time shows no obvious
  duplication.
* **Follow-on owner**: none required; recorded for traceability.

### DI-4 — Out-of-scope test file touches in Phase 05

* **Where**: `backend/tests/use_cases/project/test_export_dbt_project.py`
  and `backend/tests/use_cases/project/_dbt/test_zip_orchestrator.py`
  (both surfaced in
  [`deliver/upstream-issues.md`](deliver/upstream-issues.md)).
* **Why**: both files contained legacy-mechanism-pinning substring
  assertions on the form `'TRIM("name")' in sql` that interrogated the
  legacy CTE compiler's bare-string TRIM emission. After MR-5 the ibis
  pipeline emits `TRIM("<alias>"."<col>", '<chars>')` — same operation,
  different byte shape. The Iron Rule's never-modify-a-failing-test
  does NOT apply to L1-L3 test-refactoring of pre-existing
  legacy-mechanism-pinning assertions per `nw-test-refactoring-catalog`,
  but the touched files were not listed in the step's
  `files_to_modify`.
* **Resolution**: surfaced in `deliver/upstream-issues.md` for
  transparency; both rewrites were L2 (contract-mirroring) per
  `nw-test-refactoring-catalog`. No further action.

### DI-5 — Phases 01 + 02 lack DES execution-log tracking (cross-feature parallel to user-flow-state-machines' DI-4)

* **Where**: `deliver/execution-log.json` starts at event `03-01 /
  PREPARE` (2026-05-12T04:20:14Z). No PREPARE / RED_UNIT / GREEN /
  COMMIT entries exist for Phase 01 steps or Phase 02 steps.
* **Why**: Phases 01 + 02 shipped earlier in the week before the
  per-feature DES execution log was instantiated. The DISTILL roadmap
  was finalized 2026-05-11; Phase 01 commits landed shortly after
  (`a07777a` merge of `feat/adr-026-mr-1-view-ibis-compiler`) and
  Phase 02 followed; DES tracking for this feature began with
  azurite's Phase 03 dispatch.
* **Functional impact**: zero — the implementation is on `main`
  (commits enumerated in §5) and the acceptance scenarios those phases
  enabled are GREEN. The Refinery merge-queue gate
  (`./tools/test/test.sh --backend`) is unaffected because backend
  regression coverage runs there, not via DES.
* **Resolution**: this evolution document is the durable record. No
  further DES log catch-up is planned, consistent with the resolution
  pattern used for user-flow-state-machines DI-4.

### DI-6 — `ViewSQLGenerator` deprecation shim still in tree

* **Where**: `backend/app/use_cases/view/sql_generator.py:169-…` —
  `ViewSQLGenerator` class delegates to `ViewIbisCompiler` and emits
  `DeprecationWarning`.
* **Why retained**: per ADR-026 §"MR roadmap" → MR-1 row and the
  source research doc §"First MR shape", the shim survives for one
  release so callers (controllers, dbt-eject intermediate model
  wrapper, `update_view` use case) can switch incrementally. The shim
  is documented as deprecated in its module docstring.
* **Follow-on owner**: cleanup MR after one release boundary.
* **Action on resolution**: grep for remaining `ViewSQLGenerator`
  imports; switch to `ViewIbisCompiler`; delete the shim; remove the
  deprecation-warning import.

---

<a id="lessons-learned"></a>

## 8. Lessons learned

### 8.1 Closure by construction beats closure by defense

Gap 1 (the view-tier SQL injection vector at `sql_generator.py:160`)
was load-bearing to the whole feature. Three alternative closures were
on the table:

1. A `.replace("'", "''")` defense at the f-string interpolation site
   (Option A in early drafts; rejected as "defense, not closure").
2. A Pydantic `value`-field validator that rejects characters with SQL
   semantics (Option B; rejected because the analyst MUST be able to
   filter on values containing apostrophes — "O'Reilly" is a real
   region name).
3. A sqlglot post-hoc AST validation pass over the rendered SQL
   (Option C in ADR-026; rejected because validating after-the-fact
   means the unsafe path still exists and must be diff'd against the
   safe one).

ADR-026's binding choice — ibis literal escaping at the EXPRESSION
layer, before the string is ever rendered — is the only one where the
unsafe code path STRUCTURALLY does not exist. DWD-4 made this a HARD
constraint for DELIVER; the Phase 01 reviewer's job was to verify the
closure mechanism rather than to spot-check the test suite. **Lesson**:
when a security gap is closed by construction (the unsafe code path
doesn't exist), the verification surface shrinks from "every input
path" to "the construction itself" — pay the architecture cost
up-front; don't accept defense-in-depth as a substitute.

### 8.2 The discriminated-union-on-operator Pydantic shape paid off

`ViewFilter` started as a frozen dataclass with `operator: str` and a
single polymorphic `value: Any`. The Phase 01 implementation route
considered keeping that shape and rejecting bad `(operator, value)`
combinations at the use-case layer.

The chosen shape — a Pydantic discriminated union over `operator`, with
each variant carrying its precise value type (`str` for comparisons /
`LIKE`, `list[str]` for `IN` / `NOT IN`, `None` for `IS NULL` /
`IS NOT NULL`) — moved the rejection to the SCHEMA layer. Malformed
operators surface as a structured `InvalidViewFilter(_status_code=400)`
with a named rejected field instead of a generic 500 at the
SQL-emission boundary. The Pydantic `Literal` on the discriminator
makes "unknown operator" a compile-time impossibility for the
compiler's match arms — the `f"unsupported operator: {operator}"`
ValueError at `sql_generator.py:364` is `# pragma: no cover — guarded
by Pydantic Literal`.

**Lesson**: when a domain object has a value whose semantic type
depends on a discriminator field, a Pydantic discriminated union turns
runtime validation into a type-system invariant. The cost (slightly
more verbose model declarations) is paid once; the benefit (no
"impossible" branches in downstream code) compounds.

### 8.3 The ibis-source plugin pattern generalized

MR-2's `IbisDbtRefDuckDBCompiler` was the first instance of a
`DuckDBCompiler` subclass overriding `visit_UnboundTable` to emit dbt
macros directly during sqlglot serialization. MR-5's
`IbisDbtSourceDuckDBCompiler` is the second instance — identical
pattern, different macro shape (`{{ source(...) }}` vs
`{{ ref(...) }}`). The pattern took two MRs to crystallize but the
second instance was substantially cheaper than the first.

**Lesson**: when a new ibis backend pattern emerges in a feature (here:
the macro-emission compiler subclass), the second instance validates
the abstraction. If the third instance can be parameterized over the
macro template, the pattern is ripe for extraction into a generic
`MacroEmittingCompilerMixin` helper module.

### 8.4 Parallel-compiler hazards are detectable before they bite

Phase 05's whole purpose was to eliminate a hazard that had not yet
caused a customer-visible bug: `model_sql.py` re-implemented the
staging-tier ibis pipeline as dbt CTEs, and both compilers had to be
kept in sync as new cleaning operations were added. The research doc's
§1.6 Path 10 identified this as a divergence risk BEFORE the divergence
manifested.

**Lesson**: when two compilers consume the same domain object and
emit different SQL representations, the divergence risk grows
monotonically as the domain object's operator set grows. Eliminate the
hazard at the next refactoring opportunity rather than waiting for a
divergence-induced bug; the cost of MR-5 was small (net deletion) and
the cost of a customer-visible divergence between
`SELECT * FROM stg_orders` (preview) and the dbt staging model
(eject) would have been a trust-eroding incident.

### 8.5 Brownfield routing skipped four waves and lost nothing

Per CLAUDE.md brownfield approach, this feature skipped DIVERGE /
DISCOVER / DISCUSS / DESIGN — entering directly at DISTILL because
ADR-026 was ratified at DESIGN-time. The
[`distill/upstream-issues.md`](distill/upstream-issues.md) records the
test of that decision: "every acceptance criterion derives from
ADR-026 + the research doc, which together carry all the contract
surface DISCUSS would have produced as user-stories acceptance
criteria. Refactoring features with ratified architecture do not need
user stories; the ADR is the contract."

**Lesson**: brownfield routing is a net win when the architecture
decision is upstream-ratified. The wave matrix at
`docs/research/nwave-brownfield-approach.md` §"Routing matrix" is the
load-bearing artifact — consult it FIRST before instantiating a
full-wave pipeline on a refactor.

---

<a id="workspace-cleanup"></a>

## 9. Workspace cleanup — recommendation

Per the SKILL Phase C guidance,
`docs/feature/ibis-as-only-sql-compiler/` is **NOT deleted** by this
finalize wave. The full subtree (`distill/`, `deliver/`) is mirrored
verbatim into this archive
(`docs/evolution/2026-05-12-ibis-as-only-sql-compiler/`) alongside this
FINALIZE.md.

**Recommendation for human reviewer**: after this MR lands, choose one
of:

1. **Remove** `docs/feature/ibis-as-only-sql-compiler/` outright — the
   archive is the durable home. This matches the recommendation made by
   the prior finalize (`user-flow-state-machines`).
2. **Replace with a one-line README.md** that points at the archive —
   useful if you want the wave matrix to still show the feature exists
   under `docs/feature/` (per the SKILL's note about the wave matrix
   deriving status from the workspace directory).
3. **Leave intact indefinitely** — only if there is an active reason
   (e.g., an ADR-026 amendment is pending that wants to re-open the
   distill subtree). Document the reason in a README.md at the
   workspace root.

The finalize agent's recommendation is **Option 1 (remove)**: the
archive is complete, the git history preserves the workspace's
provenance, and the `docs/evolution/README.md` index pointer makes the
feature discoverable. The DI-1 (mutation testing) / DI-2 (MR-3.5
dispatchers) / DI-6 (shim cleanup) follow-on MRs should pull from this
archive when they land, not from the temporary workspace.

The unrelated `docs/research/`, `docs/decisions/adr-026-*.md`,
`docs/decisions/adr-007-*.md`, and `docs/decisions/adr-032-*.md`
artifacts already live at canonical paths and are NOT migrated into
this archive — they are referenced from §3 and §4.

---

## 10. Pointers

* **Feature commits on `main`** (in chronological order across all five
  phases): `fdc8e1e`, `b0e9567`, `21fda79`, `49981a2`, `a77c56c`,
  `a07777a` (Phase 01) → `f7a6363`, `ada7c0a`, `03a1cdf` (Phase 02) →
  `6c81978`, `f1f3ffa`, `9953eb1`, `ddddca7`, `fd00fa7`, `8b07ecc`
  (Phase 03) → `b737f4f`, `4599668` (Phase 04) → `f4a52f3`, `2e14a5b`,
  `efb4b9f`, `0d2d801` (Phase 05). Plus the ADR-026 ratification
  pair: `b375dea` (ADR commit) + `ef65252` (ratification merge).
* **Acceptance suite**: [`tests/acceptance/ibis-as-only-sql-compiler/`](../../../tests/acceptance/ibis-as-only-sql-compiler/)
  — 11 scenarios across `test_walking_skeleton.py`,
  `test_milestone_1_*.py` (5 files), `test_milestone_2_*.py` (5 files).
  Run via:
  ```bash
  cd tests/acceptance/ibis-as-only-sql-compiler && uv run --no-project pytest
  ```
* **Production code touched**:
  * `backend/app/use_cases/view/sql_generator.py` — `ViewIbisCompiler`
    + deprecation shim.
  * `backend/app/models/view.py` — `ViewFilter` Pydantic discriminated
    union + `ViewColumn` + `ViewJoin` Pydantic models.
  * `backend/app/use_cases/view/create_view.py` — Pydantic-error →
    structured-4xx adapter.
  * `backend/app/use_cases/report/report_ibis_compiler.py` — new module.
  * `backend/app/use_cases/report/create_report.py` —
    `DeprecatedSqlDefinitionField` + `ReportRequiresDimension` +
    structured composition.
  * `agent/lib/chat/reportToolDefinitions.ts` — `sqlDefinition` /
    `expr` removed, `.strict()` applied.
  * `backend/app/use_cases/project/_dbt/ibis_dbt_source.py` —
    `IbisDbtRefDuckDBCompiler` + `IbisDbtSourceDuckDBCompiler`.
  * `backend/app/use_cases/project/_dbt/intermediate.py` — drops
    post-render dbt-ref regex.
  * `backend/app/use_cases/project/_dbt/model_sql.py` — thin
    orchestrator over the ibis pipeline + `{{ source(...) }}` emission.
  * `backend/app/repositories/lake/repository.py` — `quote_ident()`
    hygiene at lines 214-277.
* **Architecture artifacts (archived here)**:
  * [`distill/`](distill/) — DISTILL wave decisions, 5-phase
    `roadmap.json` with manual review gates, walking-skeleton +
    milestone-1 + milestone-2 feature files, empty
    `upstream-issues.md` (back-propagation log).
  * [`deliver/`](deliver/) — DELIVER execution log (steps 03-01..05-01
    fully tracked; Phases 01 + 02 untracked per DI-5),
    phase-scoped roadmaps (`roadmap-phase-03.json`,
    `roadmap-phase-04.json`, top-level `roadmap.json` scaffolding
    Phase 05), Phase 03 wave decisions
    (`wave-decisions-phase-03.md`), and `upstream-issues.md` covering
    the DI-4 out-of-scope test touches and the pandera workspace note.
* **Permanent companion artifacts (NOT in this archive)**:
  * [`docs/decisions/adr-026-ibis-as-only-sql-compiler.md`](../../decisions/adr-026-ibis-as-only-sql-compiler.md)
    — the design ratification.
  * [`docs/decisions/adr-007-ibis-for-sql-generation.md`](../../decisions/adr-007-ibis-for-sql-generation.md)
    — the precedent ADR.
  * [`docs/research/deterministic-sql-construction-architecture.md`](../../research/deterministic-sql-construction-architecture.md)
    — the §3 three-gaps analysis + §6 5-MR roadmap.
  * [`docs/research/ibis-cel-deterministic-sql.md`](../../research/ibis-cel-deterministic-sql.md)
    — the rejected CEL design (preserved for §5 worked examples).
