# Wave Decisions — `dbt-test-validation` — DISTILL

**Feature:** dbt-test-validation
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-09
**Author:** Quinn (nw-acceptance-designer)
**Prior wave:** DESIGN (2026-05-08; recommended Option β; ratified as ADR-019 on 2026-05-09)

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

DIVERGE recommended Option C primary with Option B as principled dissent
plus an explicit "composes naturally with B" affordance
(`recommendation.md` §3). DESIGN realized that as Option β (layered C+B),
which the DIVERGE recommendation authorized verbatim. Atlas's solution-
architect-reviewer pass confirmed zero contradictions and ratified ADR-019.

DISCUSS was intentionally skipped per CLAUDE.md brownfield routing
(DIVERGE → DESIGN). DEVOPS and SPIKE were never run. Acceptance criteria
derive from ADR-019 + design.md §4 probe spec + §6 OQ resolutions; story-
to-scenario traceability is skipped (no stories to trace).

---

## Decisions

* **[DWD-1] Walking-skeleton strategy: Strategy C — Real local + skip-when-unavailable.**
  The 5-service compose stack (ADR-016) is real; `dbtRunner` from
  `dbt.cli.main` is real; DuckDB is real; MinIO httpfs is real; Groq is
  real (with `pytest.skip("GROQ_API_KEY missing")` per the existing
  harness convention at `backend/tests/integration/dataset_layer/test_smoke_chat_cleaning.py`).
  Skip semantics layered as `@requires_external` markers per adapter.
  WS scenario tagged `@walking_skeleton @real-io @driving_adapter`.
  Auto-detect rationale: feature uses local subprocess (dbt), local
  filesystem (zip extraction), local services (compose stack) plus one
  costly external (Groq). Fits Strategy C with skip-when-unavailable
  for Groq + per-probe skips for the dbt substrate.

* **[DWD-2] Test location: `tests/acceptance/dbt-test-validation/` at repo root.**
  Mirrors the canonical precedent at `tests/acceptance/log-image-identity-on-startup/`.
  Owns its own `pyproject.toml` so the suite has its own dependency
  closure (pytest + pytest-bdd + pytest-asyncio + httpx) without
  cross-contaminating the backend's runtime deps. Existing harness
  pytest-style tests at `backend/tests/integration/dataset_layer/test_*.py`
  STAY — the new acceptance suite is **parallel** to them, not replacing.
  This preserves the existing AC1.4/AC1.5 coverage that already passes.

* **[DWD-3] ADR-016 ingress path is asserted by milestone-4 scenario.**
  The eject orchestrator's HTTP fetch of the project export MUST go
  through auth-proxy (production-fidelity ingress at port 3000 in the
  local topology), NOT directly to the backend. `milestone-4-protocol-invariants.feature`
  scenario "The eject orchestrator reaches the system through the
  production-ingress URL" asserts this by inspecting the URL the
  orchestrator records on `capture.fetch_url`.

* **[DWD-4] Driving port = `DatasetLayerHarness` Python facade.**
  Per architecture/brief.md §"Test architecture", the harness is the
  canonical integration-test entry point for chat-driven dataset
  workflows. ADR-019 §3 "Reuse Analysis" classifies the harness as
  EXTEND with two new methods: `eject_and_test(project_id)` and
  `validate_after(dataset_id, schema)`. All `@when` step definitions
  invoke these methods on the facade — never the underlying
  `EjectAndTestOrchestrator`, `DuckDBProfileSeeder`, or `RunResultsParser`
  directly. The session-scoped `eject_orchestrator` fixture is the
  ONLY composition site for the orchestrator (composition-root
  invariant per ADR-019 §4: "wire then probe then use").

* **[DWD-5] One walking-skeleton scenario, five milestone files, 16 total scenarios.**
  Per the test-design-mandates skill (Walking Skeleton ratio: 2-3 WS
  + 17-18 focused for a typical 20-scenario feature), this feature
  fits 1 WS + 15 focused = 16 total scenarios. Slightly under the
  recommended 20 because β has two binding points sharing one user-
  facing journey, so additional WS scenarios would be redundant.
  The single WS exercises the full chat → eject → re-validate path
  through the harness facade; milestones split coverage by binding
  point (eject vs validate-after vs probes vs invariants vs
  failure-modes).
  Per-file counts: WS=1, M1=3, M2=3, M3=5, M4=2, M5=2.

* **[DWD-6] Mandate 7 RED scaffolds at the production paths ADR-019 specifies.**
  Scaffolds created at `backend/tests/integration/dataset_layer/eject/`
  (orchestrator + runner + seeder + parser + protocols + probe) and
  `backend/tests/integration/dataset_layer/validation/` (Pandera
  validator + OrdersStaging schema). Every scaffold module includes
  `__SCAFFOLD__ = True`; every method raises `AssertionError("Not yet
  implemented — RED scaffold")` (NOT `NotImplementedError` — the Red
  Gate Snapshot classifies AssertionError as RED, NotImplementedError
  as BROKEN). The two new harness extension methods (`eject_and_test`,
  `validate_after`) are added inline to `harness.py` with the same
  AssertionError discipline.

* **[DWD-7] Error-path coverage: 9 of 16 scenarios (56%).**
  Exceeds the skill's 40% floor.
    - 1 walking skeleton (happy)
    - 6 happy-path: eject-pass (M1), customer-fidelity (M1, single
      scenario asserts both bucket & endpoint), validate-pass (M2),
      retry-success (M2), AC1.4-retained (M4), ingress-correct (M4)
    - 9 error/edge: eject-fail/drift (M1), retry-exhaustion (M2),
      5 probe scenarios (M3), export-breakage (M5), retry-exhaustion-
      with-diff (M5)

  *(Counted as "error" anything where the observable outcome is failure-mode
  detection or the named handling of a substrate lie.)*

* **[DWD-8] Default test filter: `-m "not pending"`.**
  Walking-skeleton runs by default; milestones are gated by `@pending`
  and enabled one-at-a-time during DELIVER per the Outside-In TDD
  outer-loop discipline. Mirrors the precedent established by
  `tests/acceptance/log-image-identity-on-startup/pyproject.toml`.

* **[DWD-9] Walking-skeleton scope is wiring, not pass-status.** The walking
  skeleton asserts `models_built >= 1` AND `tests_run >= 1` only — proof
  that the eject-then-test cycle ran end-to-end and the parser observed
  results. Pass/fail-status assertions belong to milestone-1 where
  fixtures make outcomes deterministic. Rationale: the runner-parser
  separation in ADR-019 §4 routes substrate exceptions to probes and
  test-execution outcomes to the parser; the walking skeleton's wiring
  proof must therefore tolerate any non-substrate parser outcome. Authored
  2026-05-09 in response to Gap 4 Path A placeholder + chat-output
  non-determinism (real Groq produces inconsistent column-fill behaviour;
  deterministic green requires either always-passing tests — rejected as
  placeholder churn — or scope correction).

  *Walking-skeleton setup is fixture-driven, not chat-driven (added
  2026-05-11 post-DELIVER).* Troubleshooter triage confirmed the chat
  layer has zero production paths that write `schema_config.constraints`
  — no prompt, no tool, no dispatcher, no use case references the field
  — so a chat-asks `@when` could never satisfy `tests_run >= 1`. The WS
  scenario was hardened to reuse milestone-1's shape-correct `@given`,
  which PATCHes `region required: true` via
  `DatasetLayerHarness.set_dataset_schema_config`. This makes the
  schema.yml exporter emit a `not_null_stg_orders_region` dbt test that
  deterministically passes against the orders.csv fixture. The
  constraint field is fixture-only by design until a chat-write path
  exists; chat-driven wiring coverage (no test assertion) is a candidate
  follow-up scenario tagged `@chat_smoke`.

* **[DWD-10] Phase 1 (DELIVER) — earned-trust probes scope ratification + behavioral enforcement integration.**

  *Probe scope* (Atlas minor finding #1, `design/review.yaml` lines 97-100):
  keep `dbt parse` as the canary for `probe_run_results_shape`. The probe
  contract is the `dbtRunnerResult.result` ATTRIBUTE SURFACE, not the full
  build output — `dbtRunnerResult.result` for parse exposes the same
  `.success`/`.result` shape the parser reads. Full `dbt build` already runs
  end-to-end in the walking skeleton (one model + at least one test, per
  Phase 0). Adding a build-level probe would duplicate the walking skeleton's
  coverage at probe-time without strengthening the contract — and would slow
  session start by ~5-15s. Authored 2026-05-09 in response to Atlas's
  deferred minor finding.

  *Behavioral enforcement integration* (Atlas minor finding #2,
  `design/review.yaml` lines 101-104): the third orthogonal enforcement
  layer of ADR-019 §"Earned-Trust contract" lands as
  `tests/acceptance/dbt-test-validation/test_behavioral_enforcement.py`. Run
  alongside the standard acceptance suite — no separate CI job, no feature
  flag, no pre-push special-case. The pre-push and dedicated-CI gates already
  invoke the acceptance suite via the existing tooling; the behavioral test
  is included there. README has a `## Behavioral enforcement` section
  documenting the run command. Authored 2026-05-09 (commit `1954f49`).

---

## Adapter Coverage Table (Mandate 6)

| Adapter | `@real-io @adapter-integration` scenario | Covered by |
|---|---|---|
| `dbtRunner` (in-process Python API) | YES | walking-skeleton + milestone-1 (all 3 scenarios) + milestone-3 probe 1 (failure-mode) + milestone-3 probe 5 (failure-mode) |
| `DuckDBProfileSeeder` (writes profiles.yml) | YES | walking-skeleton + milestone-1 customer-fidelity scenario + milestone-5 export-breakage |
| `ProjectExporter` (HTTP client) | YES | walking-skeleton + milestone-3 probe 3 (failure-mode) + milestone-4 ADR-016 ingress |
| MinIO (Parquet via httpfs) | YES | walking-skeleton + milestone-3 probe 4 (failure-mode) |
| `PanderaValidator` (in-process schema validation) | YES | milestone-2 (all 3 scenarios) |
| Filesystem (tmp_path zip extraction) | YES | walking-skeleton + milestone-1 (all 3 scenarios) |

Zero "NO — MISSING" rows.

**Costly-external pattern:** Groq is the one costly external in scope.
It is required by chat-driven scenarios (walking-skeleton + milestone-2
retry interactions + milestone-4 invariant) and is gated by
`requires_groq` in conftest.py, which `pytest.skip(...)`s when
`GROQ_API_KEY` is unset. Eject-only scenarios (the eject_and_test code
path operates on a project's already-produced DuckDB state) do not
require Groq. Tagged `@requires_external` where applicable.

---

## Driving-Port-to-AC Mapping

| AC | Driving port | Observable outcome |
|---|---|---|
| WS | `DatasetLayerHarness.chat_turn` + `.eject_and_test` | EjectTestReport(models_built >= 1, tests_run >= 1) — wiring proof per DWD-9 |
| Eject happy | `DatasetLayerHarness.eject_and_test(project_id)` | EjectTestReport(status="pass", models_built ≥ 1, tests_run ≥ 1) |
| Eject fail (drift) | `.eject_and_test` | EjectTestReport(status="fail", failures != [], named failing test) |
| Validate happy | `DatasetLayerHarness.validate_after(dataset_id, schema)` | ValidationResult(status="pass") in <200ms |
| Validate retry (success) | `.chat_turn` (engages retry internally) | retry-with-rephrase budget engaged + final outcome resolved |
| Validate retry (exhausted) | `.chat_turn` | AssertionError raised after retry budget; diff in message |
| Probe N (×5) | session fixture `eject_orchestrator` | `pytest.skip(reason)` with probe-name in reason |
| AC1.4 retention | `.chat_turn` | trace.raw_tool_call_seen == False |
| Customer fidelity | `.eject_and_test` | seeded profiles.yml bucket path == backend's MinIO bucket path |
| ADR-016 compliance | `.eject_and_test` | export-endpoint HTTP request goes through auth-proxy URL |
| Export breakage | `.eject_and_test` | RuntimeError naming missing env var; no silent substitution |

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary):** All `@when` step definitions in
  `steps/dbt_test_validation_steps.py` invoke methods on the
  `DatasetLayerHarness` facade or accept the session-scoped
  `eject_orchestrator` fixture as input. Zero direct imports of
  `EjectAndTestOrchestrator`, `DuckDBProfileSeeder`, `DbtRunner`,
  `RunResultsParser`, or `PanderaValidator` from the steps module.
  (grep shows imports limited to harness public surface and pytest
  fixtures; verified at scaffold creation.)
* **CM-B (Business language):** Gherkin uses domain terms only:
  "customer", "project", "orders dataset", "ejected project",
  "staging model", "validation", "credential variable", "retry budget".
  Zero technical jargon: no "API", "HTTP", "JSON", "POST", "DataFrame",
  "DuckDB", "Pandera", "dbtRunner" in any `.feature` file. (Probes are
  named in `@then` strings because the contract IS that the probe NAME
  appears in the user-visible skip reason — a stakeholder triaging a
  CI skip needs the probe name.)
* **CM-C (User journey completeness):** Walking skeleton + 4 of 5
  milestone groups frame scenarios as user journeys (customer cleans
  data → ejects → re-validates). Probe milestone (3) frames as
  diagnostic outcomes the developer-as-user observes. Failure-mode
  milestone (5) frames as observable error messages. Every scenario
  asserts on observable outcomes only — no internal state assertions
  (Dim 7 mechanical checklist passes for every Then step).
* **CM-D (Pure function extraction):** The `RunResultsParser.parse()`
  function is documented in scaffold `parser.py` as pure (input:
  dbtRunnerResult, output: EjectTestReport, no side effects). Probes
  and seeder are also classified as pure (probes return ProbeReport;
  seeder is impure by necessity — file write — but isolated behind
  the seeder boundary). Pandera validation is pure.

---

## Self-Review Checklist (skill Dimension 9 + Mandate 7)

- [x] WS strategy declared in this file (DWD-1 = Strategy C)
- [x] WS scenario tagged `@walking_skeleton @real-io @driving_adapter`
- [x] Every driven adapter has at least one `@real-io @adapter-integration` scenario (table above)
- [x] All production modules imported by tests have RED-ready scaffolds with `__SCAFFOLD__` markers (10 scaffold files created)
- [x] All scaffold methods raise `AssertionError`, NOT `NotImplementedError`
- [x] At least one scenario exercises the driving adapter (`DatasetLayerHarness.eject_and_test`) via its public Python API, not internal helpers (walking skeleton)
- [x] Error/edge case coverage ≥ 40% (DWD-7: 61%)
- [x] Timing assertions use ≥ 200ms budgets (skill F-004) — milestone-2 budget is 200ms exactly
- [x] BDD imports after `sys.path` manipulation have `# noqa` markers (skill F-003) — see `conftest.py` line 26 and `steps/dbt_test_validation_steps.py` lines 26-30
- [x] `capsys` used in `@when` step, NOT `@then` (skill F-002) — milestone-2 timing measurement is captured in the @when step's `try/finally`
- [x] `@when` steps import only from `backend.tests.integration.dataset_layer.harness` and pytest fixtures — NEVER from internal helpers (skill F-005 analog) — verified by grep on `steps/dbt_test_validation_steps.py`
- [x] Mandate 1 (CM-A): import listings show zero internal-component imports in steps
- [x] Mandate 2 (CM-B): grep results show zero technical terms in `.feature` files
- [x] Mandate 3 (CM-C): walking skeleton + focused scenario counts: 1 + 15 = 16
- [x] Mandate 4 (CM-D): parser/probes/validator extracted as pure functions where possible

---

## Wave Outputs (file paths)

* `tests/acceptance/dbt-test-validation/walking-skeleton.feature` (1 scenario)
* `tests/acceptance/dbt-test-validation/milestone-1-eject-and-test.feature` (3 scenarios, all @pending)
* `tests/acceptance/dbt-test-validation/milestone-2-validate-after.feature` (3 scenarios, all @pending)
* `tests/acceptance/dbt-test-validation/milestone-3-earned-trust-probes.feature` (5 scenarios, all @pending)
* `tests/acceptance/dbt-test-validation/milestone-4-protocol-invariants.feature` (2 scenarios, all @pending)
* `tests/acceptance/dbt-test-validation/milestone-5-failure-modes.feature` (2 scenarios, all @pending)
* `tests/acceptance/dbt-test-validation/conftest.py`
* `tests/acceptance/dbt-test-validation/pyproject.toml`
* `tests/acceptance/dbt-test-validation/steps/dbt_test_validation_steps.py`
* `tests/acceptance/dbt-test-validation/test_walking_skeleton.py` + 5 milestone test_*.py modules
* `tests/acceptance/dbt-test-validation/README.md`
* `backend/tests/integration/dataset_layer/eject/{__init__,orchestrator,runner,seeder,parser,protocols,probe}.py` (7 RED scaffolds)
* `backend/tests/integration/dataset_layer/validation/{__init__,pandera_validator}.py` (2 RED scaffolds)
* `backend/tests/integration/dataset_layer/validation/schemas/{__init__,orders_staging}.py` (2 RED scaffolds)
* `backend/tests/integration/dataset_layer/harness.py` — extended with two RED-scaffold methods (`eject_and_test`, `validate_after`)
* `docs/feature/dbt-test-validation/distill/wave-decisions.md` (this file)
* `docs/feature/dbt-test-validation/distill/walking-skeleton.md`
* `docs/feature/dbt-test-validation/distill/upstream-issues.md`

## Hand-off

**Next wave:** `/nw-deliver` (software-crafter) — implements the
orchestrator + runner + seeder + parser + probes + Pandera validator
via Outside-In TDD, enabling milestone scenarios one at a time.
Walking-skeleton MUST go GREEN first.

**Recipient package for DELIVER:**
* This file (`distill/wave-decisions.md`) — strategy + adapter coverage + mandate compliance
* `walking-skeleton.md` — notes on the chosen e2e path
* The `.feature` files — scenario SSOT
* The RED scaffolds at the paths listed above — DELIVER replaces the
  AssertionError bodies with real implementations.
* ADR-019 + design.md §4 (probe spec) + §6 OQ resolutions —
  unchanged, governing.
