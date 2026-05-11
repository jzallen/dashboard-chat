# Eject-then-Test as the Dataset-Layer Validation Strategy — Evolution

> **Feature**: dbt-test-validation
> **Finalized**: 2026-05-11
> **Architectural ratification**: [ADR-019 — Eject-then-Test as the Dataset-Layer Validation Strategy](../decisions/adr-019-eject-then-test-validation.md) (Ratified 2026-05-09)
> **Acceptance suite (preserved in place)**: `tests/acceptance/dbt-test-validation/` (17 scenarios — 1 walking-skeleton + 16 milestone)
> **Architecture artifacts (migrated)**: [docs/architecture/dbt-test-validation/](../architecture/dbt-test-validation/)
> **Walking-skeleton notes (migrated)**: [docs/scenarios/dbt-test-validation/walking-skeleton.md](../scenarios/dbt-test-validation/walking-skeleton.md)

## Summary

The `DatasetLayerHarness` integration suite now exercises chat-driven dataset workflows through two layered validation surfaces: a per-turn `PanderaValidator` (sub-200 ms feedback on shape errors) and a per-flow `EjectAndTestOrchestrator` that fetches `GET /api/projects/{id}/export/dbt`, unzips, seeds a DuckDB profile against the live MinIO datalake, and runs `dbt build` then `dbt test` through `dbt.cli.main.dbtRunner`. The customer's first ejected run IS our last test run. Five Earned-Trust probes (`probe_dbt_runner_importable`, `probe_dbt_duckdb_loadable`, `probe_export_endpoint_reachable`, `probe_minio_readable_via_duckdb`, `probe_run_results_shape`) gate the orchestrator behind a session-scoped fixture that `pytest.skip(reason)`s with the failing probe named when any substrate lie surfaces. The acceptance suite at `tests/acceptance/dbt-test-validation/` collects 17 scenarios (1 walking-skeleton + 3 milestone-1 + 3 milestone-2 + 5 milestone-3 + 2 milestone-4 + 2 milestone-5), 17 pass / 0 fail / 0 skip with the compose stack up and `GROQ_API_KEY` set. Backend gate stable at 1338 passed under `./tools/test/test.sh --backend`.

## Business Context

`dbt-project-export` already lets customers run their own dbt tests downstream, but no part of the dashboard's own test suite exercised the ejected project — meaning two parallel validation paths (in-app Python predicates + the customer's future dbt run) shared no source of truth. Every chat-protocol churn (ADR-014 wire stratification, ADR-015 presentation-state log) leaked into per-turn data assertions; the harness grew from 695 LOC to 1104 LOC across two refactors with no test-scenario growth. JOB-001 (bootstrapped to `docs/product/jobs.yaml` during this feature) names the strategic-level outcome: *validate that staged data satisfies the outcome contract using assertions that remain valid after the project is ejected to dbt.* The highest-importance under-served ODI outcome (O4 — reuse validation logic across the in-app ↔ ejected-dbt boundary; importance 9, satisfaction 2, opportunity score 16) is what the eject step satisfies by construction. The per-turn Pandera layer satisfies derived outcomes O3 (chat-protocol churn cost) and O6 (workflow-vs-data triage).

## Wave path

DIVERGE → DESIGN → DISTILL → DELIVER. DISCUSS skipped per CLAUDE.md brownfield routing — the input was a strategic problem statement, not stories. SPIKE skipped — the load-bearing substrate questions (dbt-CLI vs Python API, MinIO httpfs from DuckDB, `dbtRunnerResult.result` shape) were answered with cited dbt-core / dbt-duckdb / DuckDB docs at DESIGN and re-verified by Earned-Trust probes in DELIVER. Five Phase-0 hotfixes (S3 endpoint nesting, env-var export, profile-name plumbing, JWT auth bootstrap, DomainException HTTP mapping) and one walking-skeleton scope correction (DWD-9 — fixture-driven setup; see [Walking-skeleton hardening](#walking-skeleton-hardening) below) closed the gap between "architecturally sound" and "deterministically green."

## DIVERGE — option choice and JTBD anchor

Six options were generated under SCAMPER + Crazy 8s, each passing a 3-point diversity test (mechanism / assumption / cost). All six survived DVF filter; six were scored under pre-locked weights (T1 Subtraction 20%, T2 Reuse 15%, T3 Mechanism clarity 10%, T4 Speed-as-trust 25%, T5 Durability across ejection 30%). The custom T5 weight was locked at 30% before scoring, anchored to JOB-001's O4 opportunity score of 16.

| Rank | Option | Score | T5 |
|---|---|---|---|
| 1 | C — Eject-then-test | 4.04 | **5/5** (only 5/5 in T5) |
| 2 | B — Pandera + dbt-test export translator | 3.83 | 4/5 |
| 3 | E — Fire-and-forget + Parquet golden diff (user's framing) | 3.67 | 2/5 |
| 4–5 | A, D | — | — |
| 6 | F — `validation_plan` ChatEvent + dbt unit tests | 2.61 | — |

The user's literal "fire-and-forget" hypothesis (Option E) won on simplicity (T1=T3=T4=5/5) but lost decisively on T5 — Parquet snapshots don't ship to the customer's ejected dbt project. C was recommended with B as the principled dissent **and** as a layerable companion. DESIGN ratified the layered composition.

## DESIGN — architectural realization

**Option β (layered C+B).** Per-flow `EjectAndTestOrchestrator` (C's mechanism) for the customer-fidelity gate; per-turn `PanderaValidator` (B's per-turn layer only — NOT B's translator) for sub-200 ms feedback. Two binding points; one concept (validation). The eject step doubles as the drift detector between the two SSOTs (Pandera schema + exported `schema.yml`). γ (sampled-eject) documented as β's contingency when regression-flow count grows past M ≥ 3.

### Key design decisions (full proposal in [docs/architecture/dbt-test-validation/design.md](../architecture/dbt-test-validation/design.md))

* **D1** — Two binding points (per-flow eject + per-turn Pandera), one concept. The eject step is the drift detector.
* **D2** — `probe()` is mandatory and not deferrable. Composition-root invariant: **wire then probe then use**. Probe failure → `pytest.skip(reason)` naming the failed probe.
* **D3** — No topology change to the compose stack. The orchestrator runs in-process to pytest, OUTSIDE the compose network, invoking `dbtRunner` in-process (Python API) and reading MinIO via httpfs from a tmpdir DuckDB. Production-topology fidelity preserved (ADR-016 inherited as hard constraint).
* **D4** — Test extras isolation. `dbt-core`, `dbt-duckdb`, `pandera` added as `[project.optional-dependencies] test` extras — NOT runtime deps. `backend/app/**` MUST NOT import them; an isolation unit test enforces this.
* **D5** — `EjectOrchestratorProtocol` (`typing.Protocol`, `runtime_checkable`) defines the orchestrator boundary; mypy + a structural pytest-archon rule + a behavioral test enforce three orthogonal layers.
* **D6** — The eject orchestrator is test infrastructure, not a backend module. Lives in `backend/tests/integration/dataset_layer/eject/`.
* **D9 (post-Atlas refinement, 2026-05-09)** — Use `dbtRunner` Python API instead of `subprocess.run`. dbt is a Python tool and `from dbt.cli.main import dbtRunner, dbtRunnerResult` has been the stable entry point since dbt 1.5. Wins: no PATH dependence, no exit-code re-parse, `.result` read directly, ~50–200 ms saved per `invoke()`. Documented constraint: `dbtRunner` is not concurrency-safe within a single Python process — pytest serial + pytest-xdist per-worker isolation are both fine.

### Open Question resolutions

| OQ | Resolution |
|---|---|
| OQ1 — DuckDB topology | Fresh DuckDB seeded with same MinIO Parquet sources |
| OQ2 — eject scope | Per-flow eject for regression flows; per-turn Pandera for fast feedback |
| OQ3 — gating sequence | Accept testing inversion; `probe()` is the floor |
| OQ4 — AC1.6 wall-clock | Holds at M=1 with ~65% headroom (~85–105 s observed); γ is contingency at M ≥ 3 |
| OQ5 — per-turn assertions | AC1.4 raw-tool-call leak guard stays at protocol level; data assertions split across per-turn Pandera + per-flow dbt-test |

## DISTILL — acceptance scope

**Strategy C — Real local + skip-when-unavailable.** The 5-service compose stack (ADR-016) is real; `dbtRunner` from `dbt.cli.main` is real; DuckDB is real; MinIO httpfs is real; Groq is real (gated by `requires_groq` → `pytest.skip("GROQ_API_KEY missing")`). Per-probe skips for the dbt substrate.

**Test location.** `tests/acceptance/dbt-test-validation/` at repo root with its own `pyproject.toml` + venv. Mirrors the canonical precedent at `tests/acceptance/log-image-identity-on-startup/`. Existing harness pytest-style tests at `backend/tests/integration/dataset_layer/test_*.py` STAY — the new suite is **parallel**, not replacing.

**Scenario inventory (16 authored at DISTILL → 17 final after WS hardening backport).** One walking skeleton + 15 focused = 16 (slightly under the skill's recommended 20 because β has two binding points sharing one user-facing journey). Per-file counts: WS=1, M1=3, M2=3, M3=5, M4=2, M5=2.

| Milestone | Scenarios | Driving port | Substrate exercised |
|---|---|---|---|
| Walking skeleton | 1 (`@walking_skeleton @real-io @driving_adapter`) | `harness.chat_turn` + `harness.eject_and_test` | full chat → eject → dbt build/test → parse |
| M1 — eject-and-test | 3 (eject-pass / drift-detector / customer-fidelity) | `harness.eject_and_test` | dbtRunner, profile seeder, parser |
| M2 — validate-after | 3 (pass / retry-success / retry-exhausted) | `harness.chat_turn(validate_with=schema)` | PanderaValidator + AC1.5 retry budget |
| M3 — earned-trust probes | 5 (one per probe failure injection) | `eject_orchestrator` fixture | each probe's specific lie |
| M4 — protocol invariants | 2 (AC1.4 retention + ADR-016 ingress) | `harness.chat_turn` / `harness.eject_and_test` | wire vocabulary + ingress URL |
| M5 — failure modes | 2 (unknown env_var rejection / retry exhaustion with diff) | `harness.eject_and_test` / `harness.chat_turn` | seeder env-var guard + structured retry exhaustion |

Error/edge coverage 9/16 = 56% (exceeds skill 40% floor). Every driven adapter has at least one `@real-io @adapter-integration` scenario (dbtRunner, DuckDBProfileSeeder, ProjectExporter, MinIO httpfs, PanderaValidator, filesystem).

## DELIVER — phases and outcomes

Eleven roadmap steps split across two phase groups in `deliver/roadmap.json` (Phase 0: walking-skeleton green; Phase 02: eject-and-test full coverage). Phase 01 (M3 earned-trust probes) was scoped and dispatched separately between the two roadmap phases. All 11 roadmap steps + 7 Phase-01 steps recorded EXECUTED/PASS in `deliver/execution-log.json`.

### Phase 0 — walking skeleton green (8 steps)

Drove the WS scenario from RED scaffolds (`__SCAFFOLD__ = True`; AssertionError bodies per Red Gate Snapshot, NOT NotImplementedError) to thin real implementations of every component on the path. Eight commits + six hotfixes:

| Step | Commit | Module |
|---|---|---|
| 00-01 | `ab6b6ac` | `backend/pyproject.toml` test extras (dbt-core, dbt-duckdb, pandera) + isolation guard |
| 00-02 | `25c71ed` | `DuckDBProfileSeeder` writes concrete `profiles.yml` |
| 00-03 | `b71b690` | `DbtRunner` via `dbt.cli.main.dbtRunner` (D9) |
| 00-04 | `eff07f7` | `RunResultsParser` translates `dbtRunnerResult` → `EjectTestReport` |
| 00-05 | `7454572` | Five probe happy paths |
| 00-06 | `de36d37` | `EjectAndTestOrchestrator` composes probes + seeder + runner + parser |
| 00-07 | `01dd6a2` | `PanderaValidator` + `OrdersStaging` schema |
| 00-08 | `81ef97a` | Wire `harness.eject_and_test` / `harness.validate_after` + session-scoped `eject_orchestrator` fixture |

Hotfixes (each surfaced by a probe failing loudly with a named reason — Earned Trust did its job): `62529be` (wire acceptance venv to backend test deps), `155f697` (map DomainException to structured HTTP), `961dd0a` (probes wire dev JWT + MinIO bootstrap), `b227a98` (pass exported dbt profile name to seeder), `dac4c1a` (export `S3_*` env vars before `dbtRunner.invoke`), `5f84c2d` (nest dbt-duckdb `s3_*` keys under `settings:` — the bug that was contacting AWS S3 instead of MinIO; YAML nesting issue, not a value issue), `50e55be` (placeholder: schema.yml exporter emits one `not_null` test on first column).

### Phase 01 — earned-trust probes (7 steps; M3 milestone, dispatched independently)

| Step | Commit | Probe |
|---|---|---|
| 01-01 | `93f025a` | M3 probe-1 (dbt-core importability — named-skip glue) |
| 01-02 | `906249a` | M3 probe-2 (dbt-duckdb loadability — adapter monkeypatch) |
| 01-03 | `89119c8` | M3 probe-3 (export endpoint reachability — unreachable base URL) |
| 01-04 | `2e1c077` | M3 probe-4 (MinIO readability via httpfs — invalid creds) |
| 01-05 | `41cf915` | M3 probe-5 (`dbtRunnerResult.result` shape — shape-drift monkeypatch) |
| 01-06 | `f4018c7` | Behavioral CI gold-test for Earned-Trust contract (Atlas minor finding #2) |
| 01-07 | `dd073d8` | Documentation: DWD-10 + close Atlas minor findings #1 + #2 |

Atlas's minor finding #1 was ratified — keep `dbt parse` as the canary for `probe_run_results_shape`. `dbtRunnerResult.result` for parse exposes the same `.success`/`.result` shape the parser reads; full `dbt build` already runs in the walking skeleton; adding a build-level probe would duplicate WS coverage at probe-time without strengthening the contract and would slow session start by ~5–15 s.

### Phase 02 — constraint-driven test emission + drift detector + customer fidelity (3 steps)

| Step | Commit | What landed |
|---|---|---|
| 02-01 | `858a33e` | `schema_yml.py` translates `dataset.schema_config.fields[col].constraints` → per-column test blocks (required→not_null, unique→unique, accepted_values→accepted_values, range→`dbt_utils.expression_is_true`). Phase-0 always-emit-not_null placeholder removed. `generate_dbt_project_zip` emits `packages.yml` iff at least one model references a `dbt_utils` test. |
| 02-02 | `f497b69` | `RunResultsParser.parse` extracts failing test name from `dbtRunnerResult.result` records. `EjectTestReport.failures[*].name` carries the dbt test identifier (e.g. `not_null_stg_orders_region`). Milestone-1 drift-detector scenario asserts the failing-name path. |
| 02-03 | `ce6c0cf` | `DuckDBProfileSeeder` exposes seeded s3 endpoint + bucket through observable surfaces; `EjectTestReport.seeded_profile_bucket` / `.seeded_profile_endpoint` populated by the orchestrator from the same `minio_creds` the seeder consumed. Milestone-1 customer-fidelity scenario asserts seeded values equal backend's MinIO config (read at fixture time from the same compose env vars). |

Phase 02 reconciliation fixes (parser hygiene): `c8ae682` (parser ignores test/hook records inside dbt build phase) + `215101e` (also filter dbt hooks out of test phase + align acceptance loop scope).

### Phase 3 — validate-after layer (M2)

Three atomic commits; backend gate stable at 1328 passed (was 1320). Acceptance suite collects 13 scenarios (was 10) with the M2 trio joining under the same Strategy-C skip-when-unavailable contract.

| # | Commit | Purpose |
|---|---|---|
| 1 | `ea84b60` | timing-budget guard + tighten `OrdersStaging.quantity` to two-sided `in_range(1, 10000)` (mirrors the `accepted_range` dbt test the schema.yml exporter emits — keeps the two SSOTs in lockstep) |
| 2 | `623dc81` | `chat_turn(validate_with=schema)` hook engages AC1.5 rephrase loop on Pandera failure |
| 3 | `01900dd` | M2 step glue (S1 + S2 + S3) goes from `pytest.fail` scaffolds to real bodies; substrate-side `monkeypatch` on `PanderaValidator.validate` drives deterministic pass/fail/exhaustion paths |

### Phase 4 — protocol invariants (M4)

| Commit | Purpose |
|---|---|
| `3c5bbd6` | M4 protocol invariant scenarios unpended (AC1.4 retention + ADR-016 ingress URL inspection on `capture.fetch_url`) |
| `54fa4f1` | ruff I001 import-sort cleanup |

### Phase 5 — failure modes (M5)

Two atomic commits; backend gate stable at 1338 passed (was 1332). Acceptance suite collects 17 scenarios (was 16).

| # | Commit | Purpose |
|---|---|---|
| 1 | `5f8d02a` | `DuckDBProfileSeeder.seed()` scans the unzipped export's `profiles.yml` for `env_var('NAME')` references; names not in `_KNOWN_EXPORT_ENV_VARS` raise `RuntimeError`. Defaults in the `env_var()` call do NOT excuse an unknown name — the maintainer must explicitly acknowledge each ref. design.md §13 Risk #1 substrate-lie defense. |
| 2 | `5f931f1` | `harness.StructuredRetryExhaustion` (subclasses `AssertionError` so `pytest.raises(AssertionError)` call sites keep working) carries `prompt`, `attempts`, `validation_diff`, `sse_transcript` as typed attributes — JOB-001 O6 triage signal. `pandera_validator.serialize_diff(result)` parses `ValidationResult.errors` into structured `{column, check, value}` entries with `raw` fallback when message format drifts. |

## Walking-skeleton hardening

The merge `de57afe` (2026-05-11) replaced the WS scenario's chat-driven `@when` with a fixture-driven `@given` that PATCHes a `not_null` constraint via the dataset API. Triage (recorded in `distill/wave-decisions.md` DWD-9) confirmed the chat layer has zero production paths that write `schema_config.constraints` — no prompt, no tool, no dispatcher, no use case references the field — so a chat-asks `@when` could never satisfy `tests_run >= 1` deterministically against real Groq output. The WS now reuses milestone-1's shape-correct `@given` to PATCH `region required: true` via `DatasetLayerHarness.set_dataset_schema_config`. This makes the `schema.yml` exporter emit a `not_null_stg_orders_region` dbt test that deterministically passes against the `orders.csv` fixture. The constraint field is fixture-only by design until a chat-write path exists; chat-driven wiring coverage (no test assertion) is a candidate follow-up tagged `@chat_smoke`.

The WS scope is intentionally narrow: `EjectTestReport.models_built >= 1` AND `tests_run >= 1` only — proof that the eject-then-test cycle ran end-to-end and the parser observed results. Pass/fail status assertions belong to milestone-1 where fixtures make outcomes deterministic (DWD-9 — authored 2026-05-09 in response to non-deterministic chat output producing data-dependent pass/fail; hardened 2026-05-11 with the fixture-driven setup).

## Phase 0 substrate gaps (each caught loudly by a probe)

| Gap | Resolution | Why this matters |
|---|---|---|
| dbt-duckdb 1.10.1 contacting AWS S3 instead of MinIO | `5f84c2d` — nest `s3_*` keys under `settings:` per dbt-duckdb 1.10's profile contract | Seeded values were correct; only YAML nesting was wrong. Bare keys at output level were silently dropped, resolving the bucket against AWS public S3. Probe `probe_minio_readable_via_duckdb` caught it as the "compiles but cannot read" lie. |
| `localhost:1042/api/auth/callback` 500 | transient; unreproduced post-fix-#5 | Pytest fixture-discovery ordering artifact. Did not recur. |
| Export emits no dbt tests (Phase 0 placeholder) | `50e55be` (one `not_null` on first column) → Phase 02 `858a33e` (constraint-driven mapping) | Without exported tests the eject-then-test mechanism is decorative — the validation gate cannot fail or pass on real schema-rule violations. The Phase-0 placeholder kept WS observable; Phase 02 made the gate faithful. |
| 9 milestone scaffolds | Intentional Phase-0-only scope; closed in Phases 01, 02, 03, 04, 05 | Outside-In TDD outer-loop discipline — one scenario at a time. |
| WS scope assumed deterministic chat output | DWD-9 + walking-skeleton scope correction (`5b65e47`) → `de57afe` (fixture-driven `@given`) | Real Groq produces inconsistent column-fill behaviour. Deterministic green requires either always-passing tests (rejected as placeholder churn) or scope correction. The latter shipped. |

Earned Trust did its job at every gap: every failure surfaced with a named probe reason, not a silent green or confusing red.

## Cross-decision composition

* **ADR-019 ↔ ADR-007** — Ibis materializes the in-app DuckDB tables; the exported dbt project's compiled SQL targets a separate DuckDB instance reading the same Parquet sources. Two DuckDBs, one source-of-truth (MinIO Parquet). The eject step exercises the SQL-generation path that ships; it does not reuse Ibis's runtime materialization.
* **ADR-019 ↔ ADR-014** — Independent. β does NOT add new ChatEvent types (Option F was declined precisely on these grounds). The wire schema is unchanged.
* **ADR-019 ↔ ADR-015** — Independent. The presentation-state log is orthogonal to data-shape validation.
* **ADR-019 ↔ ADR-016** — Hard constraint inherited. The 5-service compose stack is unchanged; the orchestrator runs OUTSIDE the compose network. Production-topology fidelity preserved.
* **ADR-019 ↔ ADR-017** — Independent.
* **ADR-019 ↔ JOB-001** — Strategic-level outcome (durability across ejection) satisfied by the eject step; per-turn layer satisfies O3 and O6.

The DESIGN ratified an ADR collision resolution: `75fd517` renumbered the originally-drafted ADR-018 to ADR-019 because the Redis epic concurrently claimed ADR-018.

## Risks carried forward

1. **Two SSOTs for the data contract** (Pandera schema + dbt `schema.yml`). The eject step IS the drift detector — if they diverge, eject-and-test fails. Documented; acceptable; M2 quantity range tightening (Phase 3) demonstrates the discipline of co-evolving the two surfaces.
2. **`dbt-core` minor-version drift on `dbtRunnerResult.result`.** dbt explicitly documents this surface as "not fully contracted." Test extras pin `dbt-core>=1.8`; `probe_run_results_shape` is the canary. The DEVOPS-handoff recommendation (golden-fixture contract test runnable in CI without the compose stack) is **deferred** — not in scope for finalize.
3. **Customer uses CLI; we use Python API.** Both route through `dbt.cli.main` so behaviour is identical, but signal-handling and exit-code semantics differ at the edges. Documented.
4. **`dbtRunner` is not concurrency-safe within a single Python process.** pytest serial + pytest-xdist per-worker isolation are both fine. Intra-test parallelism would require subprocess isolation per concurrent invocation.
5. **γ (sampled-eject) is β's degraded mode at M ≥ 3 regression flows.** Not lit up today (M=1). Documented contingency.

## Outcome

* **Acceptance suite**: 17 scenarios, 17 pass / 0 fail / 0 skip with compose stack up + `GROQ_API_KEY` set.
* **Backend gate**: 1338 passed / 1 skipped under `./tools/test/test.sh --backend`. Stable.
* **Production deps untouched**: `dbt-core`, `dbt-duckdb`, `pandera` confined to `[project.optional-dependencies] test`; isolation guard at `backend/tests/unit/test_test_extras_isolation.py` enforces `backend/app/**` does not import them.
* **JOB-001 / O4 outcome score**: satisfied by construction — the validation logic in `tests/acceptance/dbt-test-validation/` IS what the customer runs when they eject.
* **Earned-Trust contract**: enforced at three orthogonal layers (mypy/Protocol subtype + pytest-archon structural rule + behavioral CI test in `tests/acceptance/dbt-test-validation/test_behavioral_enforcement.py`).
* **Walking-skeleton wiring proof**: `models_built >= 1` AND `tests_run >= 1`, deterministically green via fixture-driven `@given` (DWD-9 + WS hardening merge `de57afe`).

## Migration to dbt-test driver (ADR-024)

The architecture ratified in this evolution doc was rebalanced shortly after finalize. The maintenance-load profile of the harness-facade-driven realization (`EjectAndTestOrchestrator` family + 5 Earned-Trust probes + `harness.eject_and_test` + behavioral-enforcement gold-test) exceeded its scenario-count value once the architecture lived under maintenance: ~3,850 LOC of test infrastructure carrying 5 customer-fidelity scenarios (the other 12 were probe-coverage, protocol invariants, and retry semantics that did not need the eject substrate). [ADR-024](../decisions/adr-024-rebalance-dbt-test-validation.md) (Accepted 2026-05-11) rebalanced the architecture toward a procedure-shaped dbt-test driver while preserving the JOB-001 / O4 strategic-level outcome by construction.

**Surviving scope after migration**:
* **5 customer-fidelity scenarios** via the v2 procedure-driver at `tests/acceptance/dbt-test-validation-v2/` (WS + M1.1 happy path + M1.2 drift detector + M1.3 customer fidelity + M5.1 env-var rejection). The driver is a single ~545 LOC module replacing the orchestrator + probe + parser + seeder + runner stack.
* **1 per-turn Pandera test** at `backend/tests/integration/dataset_layer/validation/test_pandera_per_turn.py` (M2.1 ported per DR-1 — Pandera per-turn is integration, not customer-fidelity acceptance).
* **1 chat-protocol invariant** at `backend/tests/integration/dataset_layer/protocol_invariants/test_raw_tool_call_leak_guard.py` (AC1.4 retention). The ADR-016 production-ingress URL invariant was retired with the orchestrator — the test was structurally coupled to `EjectAndTestOrchestrator._base_url`; the invariant it asserted is now satisfied by construction in the v2 driver (`base_url` built only from `auth_proxy_url`, no internal-port fallback). See [adr-024-phase-4-blocker.md](../research/adr-024-phase-4-blocker.md) for the reclassification analysis.
* **3 retry-semantics unit tests** at `backend/tests/unit/test_retry_semantics.py` (M2.2 + M2.3 + M5.2 ports — pure unit shape with stubbed `ChatApi.send_turn`, stubbed `DatasetsApi.get_table_state`, and monkeypatched `PanderaValidator.validate`).

**LOC delta**: The v1 acceptance suite + eject infrastructure + harness extensions retired across Phase 4 (sub-MRs 4a/4b/4c/4d) totalled ~5,400 LOC of test infrastructure deleted. The v2 driver (~545 LOC) is the surviving customer-fidelity surface; M2.1 ported to `validation/` and the retry + protocol-invariant tests reclassified per the migration roadmap. Net migration LOC across Phases 1–4: ~-5,000 to -5,300 (revised upward from the spike's "~3,000 LOC net deletion" estimate, which had measured only the integration-test surface — the structural unit-test layer at `backend/tests/unit/` was undercounted by ~1,886 LOC in the original survey; see [adr-024-phase-4-blocker.md](../research/adr-024-phase-4-blocker.md)).

**Earned-Trust contract — how it survives**: D2's "wire then probe then use" discipline shipped as 5 session-scoped probes gating the orchestrator. In the v2 driver the contract is satisfied differently: each substrate boundary surfaces its failure mode loudly at the point of use (e.g. an unreachable export endpoint raises a typed exception inside the driver's fetch step; an unknown `env_var()` name in the exported `profiles.yml` raises `RuntimeError` during seeding). The session-scoped probe layer is gone, but the property the probes existed to enforce — substrate lies surface as named errors, not silent greens or confusing reds — is preserved by inline failure modes. The behavioral-enforcement gold-test (which existed to gate the probe contract on the orchestrator) was retired with the orchestrator since it had nothing to gate.

**Customer-fidelity invariant — how it survives**: O4 (validation logic durable across the in-app ↔ ejected-dbt boundary) was satisfied in the original architecture by construction — the validation logic in `tests/acceptance/dbt-test-validation/` IS what the customer runs. Under the v2 driver the same property holds: the driver fetches `GET /api/projects/{id}/export/dbt`, unzips, seeds a DuckDB profile from the SAME MinIO credentials the backend uses, and invokes `dbtRunner` against the customer's exported artifact. The driver's `EjectTestReport.seeded_profile_bucket` / `.seeded_profile_endpoint` fields are observable surfaces asserted by M1.3 (customer fidelity) against the backend's live MinIO config — the same drift-detector property the original orchestrator's probes enforced.

**Cross-references**:
* [ADR-024 — Rebalance dbt-test-validation](../decisions/adr-024-rebalance-dbt-test-validation.md) (Accepted 2026-05-11; all 5 phases merged).
* [Migration roadmap](../feature/rebalance-dbt-test-validation/design/migration-roadmap.md) — phase order, sub-MR plan, decision records, and outcomes table.
* [Phase 4 blocker research](../research/adr-024-phase-4-blocker.md) — pre-flight grep that surfaced ~1,886 LOC of structural unit tests plus the ingress-invariant coupling not enumerated in the original roadmap.
* [Deterministic SQL construction architecture](../research/deterministic-sql-construction-architecture.md) — parallel discovery during this work surveying SQL-emission determinism across staging/view/report tiers; emerged as a follow-up rather than a blocker for the rebalance.

## What was discarded at finalize

These artifacts were process scaffolding — valuable during delivery, disposable after, with no permanent referents:

* `deliver/execution-log.json`, `deliver/roadmap.json`, `deliver/.develop-progress.json` — audit trail and step plan; superseded by this doc + git history.
* `design/review.yaml`, `diverge/review.yaml`, `distill/review.yaml` — review findings captured here.
* `distill/upstream-issues.md` — DISTILL-wave issues, all resolved in DELIVER.
* `*/wave-decisions.md` — extracted into the relevant sections above.

These artifacts were migrated to permanent directories:

* `design/design.md`, `design/c4-diagrams.md`, `design/upstream-changes.md` → `docs/architecture/dbt-test-validation/`
* `distill/walking-skeleton.md` → `docs/scenarios/dbt-test-validation/`

ADR-019 (`docs/decisions/adr-019-eject-then-test-validation.md`) was already in its permanent location during DESIGN.
