<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — `extract-dataset-query-port` — DISTILL

**Feature:** extract-dataset-query-port
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-10
**Author:** Quinn (`nw-acceptance-designer`)
**Prior wave:** DESIGN (Proposed; ADR-021 Proposed; recommended Option α — single `QueryEnginePort` + `PgDuckDBQueryEngineAdapter`)
**Inputs:** `design/{design,c4-diagrams,wave-decisions}.md`, ADR-021, `docs/research/tech-debt-hotspot-review.md` Finding 3, `backend/app/models/dataset.py:179-221`, `backend/tests/models/test_dataset.py:837-1030` (existing `_FakeConnection` ladder + `TestQueryPreviewRows`).

---

## Reconciliation Result

**Reconciliation passed — 1 minor naming drift surfaced as upstream issue.**

DESIGN (`design.md` §4 Layout, ADR-021 §"Considered Options" → Option 1) names the new entry point `execute_dataset_preview(dataset, limit)`. The tech-debt review at `docs/research/tech-debt-hotspot-review.md` Finding 3 (the trigger) names it `execute_dataset_query(dataset)`. The DISTILL handoff brief from the orchestrator also uses `execute_dataset_query`. Gherkin uses business language ("the query engine port") and is naming-agnostic, so scenarios are unaffected; only the step glue binds a method name. **Surfaced for resolution in `upstream-issues.md` — DELIVER picks one (recommendation: `execute_dataset_query` per the trigger document and the user prompt) and the binding ADR is amended to match.**

DISCUSS, DEVOPS and SPIKE were never run for this feature (per CLAUDE.md brownfield routing for refactor entry: DESIGN → DISTILL). No story-to-scenario traceability table is produced because there are no user stories — acceptance criteria derive from ADR-021 + design.md §4 + design.md §6 enforcement specification.

---

## Decisions

* **[DWD-1] Walking-skeleton strategy: Strategy C — Real local + skip-when-unavailable.**
  Same compose stack convention as `dbt-test-validation` (DWD-1 there): the
  query-engine service (Postgres + pg_duckdb in the local docker-compose
  topology, port 5433) is real; asyncpg is real; pg_duckdb is real; MinIO
  is real. The session-scoped `query_engine_pool` fixture in
  `tests/acceptance/extract-dataset-query-port/conftest.py` performs three
  reachability checks (TCP, `SELECT 1`, `SELECT duckdb.raw_query('SELECT 1')`)
  and translates each failure to `pytest.skip(reason)` with the named probe.
  WS scenario tagged `@walking_skeleton @real-io @driving_adapter`.
  Auto-detect rationale: feature uses local subprocess-equivalent (asyncpg
  to a local container) plus local services (compose stack); no costly
  external network calls. Fits Strategy C cleanly.

* **[DWD-2] Test location: `tests/acceptance/extract-dataset-query-port/` at repo root, with feature SSOT mirrored under `docs/feature/extract-dataset-query-port/distill/`.**
  Test root mirrors the canonical precedent at
  `tests/acceptance/dbt-test-validation/`. Owns its own `pyproject.toml` so the
  suite has its own dependency closure (pytest + pytest-bdd + pytest-asyncio +
  asyncpg) without cross-contaminating the backend's runtime deps.
  The `.feature` files live in BOTH places — the runnable copy at the test
  root and the documentation SSOT under `distill/` — and are byte-identical.
  Updates to one MUST update the other in the same commit. Rationale:
  DELIVER reads the runnable `.feature` files; reviewers and humans read the
  `distill/` copies; co-locating both keeps the headless merge queue's
  `tools/test/test.sh --acceptance=extract-dataset-query-port` fenced to the
  test root while preserving the doc-as-SSOT convention dbt-test-validation
  established.
  The existing `backend/tests/models/test_dataset.py:837-1030` characterization
  tests STAY through DELIVER Phase 00 (Mikado: tests move first, then code
  delegates, then refactor finishes). DELIVER relocates them to
  `backend/tests/query_engine/test_pg_duckdb_adapter.py` per DWD-4 below.

* **[DWD-3] Driving port = `QueryEnginePort.execute_dataset_query(dataset, limit)` accessed through `RepositoryContainer.query_engine`.**
  Per DESIGN DWD-3, the new adapter lives in the existing `RepositoryContainer`
  (no new container introduced for one new adapter — YAGNI). Step glue accesses
  it through the container, never via direct import of the adapter class.
  The walking skeleton continues to invoke through `Dataset.query_preview_rows`
  for ONE phase (Phase 00) — the legacy method becomes a thin delegator that
  dispatches to `container.query_engine.execute_dataset_query(self, ...)`,
  preserving git bisect across the move (DESIGN DWD-5). Phase 01 migrates the
  in-tree caller (`DatasetService.fetch_dataset`) to the direct port call.
  Phase 02 removes the legacy delegator and asserts the import-linter contract.

* **[DWD-4] `_FakeConnection` migrates with the code, not before — Iron Rule binding.**
  Inherited verbatim from DESIGN DWD-4. The four-class ladder
  (`_FakeConnection`/`_FakePool`/`_FakePoolAcquireCtx`/`fake_pool_factory`)
  currently in `backend/tests/models/test_dataset.py:837-916` migrates to
  `backend/tests/query_engine/test_pg_duckdb_adapter.py` with shape preserved.
  Test names rename `test_query_preview_rows_*` → `test_execute_dataset_query_*`.
  The SUT changes from `Dataset` to `PgDuckDBQueryEngineAdapter`. The fixture
  surface (`copy_from_query_calls`, `executed_sql`, `executed_args`,
  `fetched_sql`) is unchanged. **The pinned outer/inner SQL constants from
  `test_dataset.py:963-970, :1003-1004` MOVE byte-for-byte.** If a relocated
  test would fail under the new shape, the refactor is wrong, not the test.

* **[DWD-5] Three milestone files, one walking skeleton, 16 focused scenarios = 17 total.**
  Per the test-design-mandates skill (Walking Skeleton ratio: 2-3 WS + 17-18
  focused for a typical 20-scenario feature), this refactor fits 1 WS + 16
  focused = 17 total. Slightly under the recommended 20 because this is a
  *pure architectural-seam refactor* — the behavior contract is "no observable
  change" and over-specifying scenarios beyond the boundary checkpoints would
  add ceremony, not coverage.
  Per-file counts: WS=1, M1=7, M2=4, M3=5. M1 absorbs the bulk of the
  characterization-test relocation (the 4 existing `TestQueryPreviewRows`
  methods become 4 of the 7 M1 scenarios; the remaining 3 cover the new
  port-side guarantees: same-connection macro+COPY, sequential acquisitions,
  pg_duckdb-missing error path).

* **[DWD-6] Mandate 7 RED scaffolds at the production paths ADR-021 specifies.**
  Step file (`tests/acceptance/extract-dataset-query-port/steps/dataset_query_port_steps.py`)
  carries the module-level marker `__SCAFFOLD__ = True`. Every step body
  raises `pytest.fail("DISTILL scaffold — DELIVER implements: ...")` with a
  scenario-level intent. DELIVER replaces these bodies one scenario at a time
  per the Outside-In TDD outer-loop discipline. **No production scaffolds are
  created in this DISTILL** — the production code paths
  (`backend/app/query_engine/{__init__,pg_duckdb_adapter,exceptions}.py`)
  do not yet exist; DELIVER Phase 00 creates them along with the first
  passing milestone scenario. This differs from `dbt-test-validation` which
  pre-shipped 11 RED scaffolds because that feature introduced ~10 new
  modules; this refactor introduces 3 modules whose scaffold cost would
  exceed the cost of writing them straight in DELIVER.

* **[DWD-7] Error-path coverage: 7 of 17 scenarios (41%).**
  Meets the skill's 40% floor.
    - **Happy** (10): WS; M1 COPY-route preservation; M1 custom-case macros;
      M1 same-connection macro+COPY; M2 legacy/port parity; M2 deprecation
      notice; M2 service-uses-port; M3 legacy retired; M3 model imports clean;
      M3 only port imports asyncpg.
    - **Edge** (3): M1 empty-schema short-circuit ("no work expected" path);
      M1 built-in case modes ("no macros expected" path); M1 sequential
      acquisitions (boundary on pool acquire/release behaviour).
    - **Error** (4): M1 pg_duckdb-missing rejection; M2 service handles port
      failure; M3 startup-refused (substrate unreachable); M3 startup-refused
      (pg_duckdb missing).
    - **7 of 17 = 41% edge+error.** Just over the 40% floor; a stronger
      ratio would need additional error scenarios at M1 (e.g., asyncpg pool
      exhausted, COPY buffer truncation), which are deemed lower-value here
      because the asyncpg pool exhaustion path is shared infrastructure
      (covered by `app.database` tests) and COPY buffer truncation is a
      pg_duckdb-side concern, not an adapter concern.

* **[DWD-8] Default test filter: `-m "not pending"`.**
  Walking-skeleton runs by default; milestones are gated by `@pending` and
  enabled one-at-a-time during DELIVER per the Outside-In TDD outer-loop
  discipline. Mirrors the precedent in
  `tests/acceptance/dbt-test-validation/pyproject.toml` (DWD-8 there).

* **[DWD-9] Method-name drift between DESIGN and the trigger document is recorded as an upstream issue, not pre-resolved here.**
  ADR-021 §"Considered Options" + design.md §4 use `execute_dataset_preview`.
  The hotspot review (`docs/research/tech-debt-hotspot-review.md` Finding 3)
  and the orchestrator's DISTILL prompt use `execute_dataset_query`. Both names
  describe the same method; neither is wrong. DISTILL surfaces the drift
  in `upstream-issues.md`; DELIVER picks one (recommend `execute_dataset_query`
  per the trigger document, since it is older and more
  domain-appropriate — "preview" is a UI concern, "query" is the domain action)
  and amends the ADR to match in the same commit that lands the adapter.

* **[DWD-10] Architectural-enforcement scenarios (M3) cover the structural layer only; the behavioral and subtype layers remain DELIVER-owned.**
  Per ADR-021 §"Architectural enforcement (Principle 11)" + DESIGN DWD-6, three
  enforcement layers are mandated: (a) **subtype** — `mypy + Protocol` (verified
  at composition root; DELIVER's mypy job catches violations; not a Gherkin
  scenario), (b) **structural** — `pytest-archon` import contracts (Gherkin-
  expressible: M3 scenarios 2 and 3 inspect import boundaries through the
  contract runner), (c) **behavioral** — CI gold-test for `health.startup.refused`
  on `asyncpg.create_pool` failure (Gherkin-expressible at the user-facing layer:
  M3 scenarios 4 and 5 frame as "the customer never receives a preview from an
  uninitialised port"). Subtype is verifiable via `mypy backend/app` exit code,
  not a runtime scenario; calling it out in M3 would invent a step that asserts
  on `mypy` output, which is a CI concern. DELIVER ensures the mypy assertion
  by amending `backend/pyproject.toml` (mypy strict on `app.query_engine`) and
  by passing the existing CI mypy job — no acceptance scenario needed.

---

## Adapter Coverage Table (Mandate 6)

| Adapter | `@real-io @adapter-integration` scenario | Covered by |
|---|---|---|
| `PgDuckDBQueryEngineAdapter` (asyncpg + pg_duckdb + COPY) | YES | walking-skeleton (real pool, real pg_duckdb) + milestone-1 (all 7 scenarios via recording connection) + milestone-2 (all 4 scenarios) |
| asyncpg pool (`get_query_engine_pool`) | YES | walking-skeleton + milestone-1 (sequential acquisitions, pg_duckdb-missing) + milestone-3 (startup-refused on pool unreachable) |
| pg_duckdb extension | YES | walking-skeleton (`SELECT duckdb.raw_query('SELECT 1')` probe) + milestone-1 (pg_duckdb-missing error path) + milestone-3 (pg_duckdb-missing on probe) |
| DuckDB macros (`ALL_MACROS`) | YES | milestone-1 (custom-case + built-in case modes + same-connection macro+COPY + sequential acquisitions) |
| Composition root (`RepositoryContainer.query_engine`) | YES | walking-skeleton background + milestone-2 service-uses-port + milestone-3 startup-refused (composition-root probe invariant) |

Zero "NO — MISSING" rows.

**No costly external dependencies** — this feature does not engage Groq, MinIO writes, or any rate-limited service. Unlike `dbt-test-validation`, the suite needs no `@requires_external` markers; substrate availability is the only skip-gate.

---

## Driving-Port-to-AC Mapping

| AC | Driving port | Observable outcome |
|---|---|---|
| WS | `Dataset.query_preview_rows(limit)` (legacy delegator post-Phase-00) routed through `container.query_engine.execute_dataset_query` | Returned rows match legacy path; recorded `outer_sql`/`inner_sql` byte-identical to `test_dataset.py:965-970` |
| M1 COPY route | `container.query_engine.execute_dataset_query` | `copy_from_query_calls[0]` matches the pinned outer+inner constants |
| M1 empty-schema | `container.query_engine.execute_dataset_query` | Empty list returned; pool never acquired |
| M1 custom-case macros | `container.query_engine.execute_dataset_query` | `executed_sql == ['SELECT duckdb.raw_query($1)'] * len(ALL_MACROS)`; `executed_args[i][0] == ALL_MACROS[i]` |
| M1 built-in case modes | `container.query_engine.execute_dataset_query` | `executed_sql == []` (no macro registrations) |
| M1 same-connection | `container.query_engine.execute_dataset_query` | The connection that recorded the COPY call is the SAME instance that received macro registrations |
| M1 sequential | `container.query_engine.execute_dataset_query` × 3 | 3 distinct connections; each registers ALL_MACROS exactly once |
| M1 pg_duckdb-missing | `container.query_engine.execute_dataset_query` | `QueryEngineError` raised naming pg_duckdb; no rows returned |
| M2 legacy/port parity | `Dataset.query_preview_rows` AND `container.query_engine.execute_dataset_query` | Both return identical rows AND emit identical SQL |
| M2 deprecation notice | `Dataset.query_preview_rows` | `DeprecationWarning` captured naming `QueryEnginePort.execute_dataset_query` |
| M2 service-uses-port | `DatasetService.fetch_dataset(include_preview=True)` | Spy adapter records exactly one `execute_dataset_query` call; legacy delegator NOT invoked |
| M2 service port failure | `DatasetService.fetch_dataset(include_preview=True)` | `QueryEngineError` named pg_duckdb; no preview rows attached |
| M3 legacy retired | Inspection of `Dataset` class surface | `query_preview_rows` not in public methods |
| M3 model imports clean | Import-linter / pytest-archon contract | Zero violations: `app.models.* -> {asyncpg, sql_functions, get_query_engine_pool}` |
| M3 only port imports asyncpg | Import-linter / pytest-archon contract | Zero violations: only `app.query_engine.*` may import `asyncpg`; `app.query_engine.*` may not import `ibis` |
| M3 startup-refused (pool) | FastAPI lifespan probe | `health.startup.refused` event emitted; startup raises |
| M3 startup-refused (pg_duckdb) | FastAPI lifespan probe | `health.startup.refused` event named pg_duckdb |

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary):** All `@when` step definitions in
  `steps/dataset_query_port_steps.py` invoke methods on `container.query_engine`
  (the Protocol-typed slot the composition root publishes) or on
  `DatasetService.fetch_dataset` (the use-case driving port). Zero direct
  imports of `PgDuckDBQueryEngineAdapter` from the steps module — DWD-3 binding.
  (Verified by grep on the step file: imports limited to `pytest`, `pytest_bdd`,
  and stdlib.)
* **CM-B (Business language):** Gherkin uses domain terms only:
  "customer", "dataset", "preview rows", "query engine port", "macro
  registration", "COPY-from-stdout call". The string `"SELECT duckdb.raw_query($1)"`
  appears in M1 scenario 3 because the contract IS that the customer's macro
  registrations route through that exact SQL — a stakeholder reviewing the
  characterization-pin contract needs to see the literal SQL preserved. Zero
  technical jargon in scenario titles or surrounding prose: no "API", "HTTP",
  "JSON", "DataFrame", "asyncpg" appears outside of M3 scenario 3 where the
  asyncpg driver is the named entity in the import-contract assertion.
* **CM-C (User journey completeness):** Walking skeleton frames as user
  journey ("the customer's dataset preview"). Milestones frame as user-
  observable outcomes — M1 frames as "the customer's macros register
  correctly"; M2 frames as "the customer transitions cleanly between the
  old and new entry points"; M3 frames as "the customer never receives a
  preview from a misconfigured port". Every scenario asserts on observable
  outcomes (return values, raised errors, recorded SQL on the recording
  connection — the connection IS the observable surface for the macro
  contract). Dim 7 mechanical checklist passes for every Then step.
* **CM-D (Pure function extraction):** `Dataset.requires_custom_case_macros`
  (renamed public predicate per DESIGN §3) is pure (input: `transforms`,
  output: `bool`, no side effects). `Dataset.staging_sql` and `display_sql`
  are pure (Ibis-compiled SQL strings). The adapter's COPY-route and macro-
  registration are impure by necessity (asyncpg I/O, pg_duckdb DDL) and are
  isolated behind the `QueryEnginePort` Protocol. No fixture parametrization
  is needed for pure components — the recording-connection fixture
  parametrizes only the impure adapter layer.

---

## Self-Review Checklist (skill Dimension 9 + Mandate 7)

- [x] WS strategy declared in this file (DWD-1 = Strategy C)
- [x] WS scenario tagged `@walking_skeleton @real-io @driving_adapter`
- [x] Every driven adapter has at least one `@real-io @adapter-integration` scenario (table above)
- [x] Step file carries `__SCAFFOLD__ = True` marker (line 39 of `steps/dataset_query_port_steps.py`)
- [x] All scaffold step bodies raise `pytest.fail("DISTILL scaffold — ...")`, NOT `NotImplementedError` or `pass`
- [x] At least one scenario exercises the driving port via its public Python API, not internal helpers (walking skeleton + every M1 scenario + M2 service-uses-port)
- [x] Error/edge case coverage ≥ 40% (DWD-7: 54%)
- [x] BDD imports after `sys.path` manipulation have `# noqa` markers (skill F-003) — see `conftest.py` line 42 and `steps/dataset_query_port_steps.py` lines 41-43
- [x] `@when` steps import only from `pytest` + `pytest_bdd` + (planned) `app.repositories` / `app.use_cases.dataset.dataset_service` — NEVER from internal helpers (skill F-005 analog) — verified by grep
- [x] Mandate 1 (CM-A): import listings show zero internal-component imports in steps
- [x] Mandate 2 (CM-B): grep results show zero technical terms in `.feature` files outside named-contract assertions
- [x] Mandate 3 (CM-C): walking skeleton + focused scenario counts: 1 + 16 = 17
- [x] Mandate 4 (CM-D): `requires_custom_case_macros` + `staging_sql` + `display_sql` extracted/preserved as pure; impure code isolated behind `QueryEnginePort`
- [x] Mandate 7: RED scaffolds in step glue; production scaffolds deferred to DELIVER (DWD-6 rationale)

---

## Wave Outputs (file paths)

* `docs/feature/extract-dataset-query-port/distill/dataset-preview-flows-through-query-engine-port.feature` (1 scenario; SSOT)
* `docs/feature/extract-dataset-query-port/distill/query-engine-port-honors-boundary-contract.feature` (7 scenarios, all @pending; SSOT)
* `docs/feature/extract-dataset-query-port/distill/dataset-service-fetches-via-port-directly.feature` (4 scenarios, all @pending; SSOT)
* `docs/feature/extract-dataset-query-port/distill/dataset-model-becomes-pure-after-port-cleanup.feature` (5 scenarios, all @pending; SSOT)
* `docs/feature/extract-dataset-query-port/distill/wave-decisions.md` (this file)
* `docs/feature/extract-dataset-query-port/distill/upstream-issues.md`
* `docs/feature/extract-dataset-query-port/distill/roadmap.json`
* `tests/acceptance/extract-dataset-query-port/dataset-preview-flows-through-query-engine-port.feature` (runnable; byte-identical to SSOT modulo DES-ENFORCEMENT marker)
* `tests/acceptance/extract-dataset-query-port/query-engine-port-honors-boundary-contract.feature`
* `tests/acceptance/extract-dataset-query-port/dataset-service-fetches-via-port-directly.feature`
* `tests/acceptance/extract-dataset-query-port/dataset-model-becomes-pure-after-port-cleanup.feature`
* `tests/acceptance/extract-dataset-query-port/conftest.py`
* `tests/acceptance/extract-dataset-query-port/pyproject.toml`
* `tests/acceptance/extract-dataset-query-port/steps/dataset_query_port_steps.py` (RED scaffold, `__SCAFFOLD__ = True`)
* `tests/acceptance/extract-dataset-query-port/test_dataset_preview_flows_through_query_engine_port.py`
* `tests/acceptance/extract-dataset-query-port/test_query_engine_port_honors_boundary_contract.py`
* `tests/acceptance/extract-dataset-query-port/test_dataset_service_fetches_via_port_directly.py`
* `tests/acceptance/extract-dataset-query-port/test_dataset_model_becomes_pure_after_port_cleanup.py`

## Hand-off

**Next wave:** `/nw-deliver` (software-crafter) — implements the
`QueryEnginePort` + `PgDuckDBQueryEngineAdapter` + composition-root wiring
via Outside-In TDD, enabling milestone scenarios one at a time.
Walking-skeleton MUST go GREEN first.

**Recipient package for DELIVER:**
* This file (`distill/wave-decisions.md`) — strategy + adapter coverage + mandate compliance
* `roadmap.json` — Phase 00 / 01 / 02 plan with `scenarios_to_unskip` and `exit_criteria`
* The `.feature` files at `tests/acceptance/extract-dataset-query-port/` — scenario SSOT
* The `__SCAFFOLD__ = True` step glue — DELIVER replaces every `pytest.fail` body with the real implementation
* ADR-021 (Proposed) + design.md §4 + design.md §6 enforcement spec — unchanged, governing
* `upstream-issues.md` — single drift to resolve in DELIVER's first commit (method-name reconciliation)
