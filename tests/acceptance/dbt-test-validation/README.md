# Acceptance — dbt-test-validation (ADR-019, Option β)

This directory holds the BDD acceptance suite for the
`dbt-test-validation` feature. See:
- `docs/decisions/adr-019-eject-then-test-validation.md` (ratified 2026-05-09)
- `docs/feature/dbt-test-validation/design/design.md` (Option β recommendation)
- `docs/feature/dbt-test-validation/distill/wave-decisions.md` (DISTILL decisions)

## Strategy

**Strategy C (real local I/O — DWD-1):** the suite drives the running
5-service compose stack (auth-proxy + backend + worker + query-engine + MinIO)
through the `DatasetLayerHarness` Python facade. Per-flow validation
invokes the real `dbtRunner` from `dbt.cli.main` against the customer's
exported project (real DuckDB, real MinIO httpfs). Per-turn validation
runs Pandera (β only) inside the existing harness retry loop.

The acceptance tests are **parallel** to the existing harness tests at
`backend/tests/integration/dataset_layer/test_*.py`, not replacing them.

## What is in here

- `walking-skeleton.feature` — single end-to-end scenario through the
  `DatasetLayerHarness.eject_and_test(...)` driving port. Runs by
  default. Tagged `@walking_skeleton @real-io @driving_adapter`.
- `milestone-1-eject-and-test.feature` — eject happy path + drift
  detector + customer-fidelity invariant. `@pending`.
- `milestone-2-validate-after.feature` — Pandera per-turn happy path +
  retry-with-rephrase budget engagement (β only). `@pending`.
- `milestone-3-earned-trust-probes.feature` — 5 probe scenarios that
  force substrate lies and assert `pytest.skip` with the failing probe
  named. `@pending`.
- `milestone-4-protocol-invariants.feature` — AC1.4 raw-tool-call leak
  retention + ADR-016 ingress compliance. `@pending`.
- `milestone-5-failure-modes.feature` — testing-inversion safety
  (export breakage) + retry exhaustion. `@pending`.
- `steps/dbt_test_validation_steps.py` — pytest-bdd glue. The walking-
  skeleton has wired bindings (against scaffold raises); milestone
  bindings are added as DELIVER enables each scenario.
- `conftest.py` — re-exports step glue at scope; provides
  `requires_compose_stack`, `requires_groq`, `eject_orchestrator`
  fixtures.
- `pyproject.toml` — declares pytest + pytest-bdd + pytest-asyncio +
  httpx; default `-m "not pending"` filters milestone scenarios out of
  the default run.

## Running

```bash
# Bring up the 5-service compose stack first.
docker compose up -d

# From repo root.
cd tests/acceptance/dbt-test-validation
uv sync --group dev
uv run pytest                                    # walking-skeleton only (default)
uv run pytest -m "walking_skeleton or pending"   # everything (after DELIVER enables)
```

## Skip-when-unavailable env vars

| Env var | Default | Effect when absent |
|---|---|---|
| `AUTH_PROXY_URL` | `http://localhost:3000` | Suite skips with "compose stack not reachable" |
| `AGENT_URL` | `http://localhost:8787` | Suite skips with "compose stack not reachable" |
| `GROQ_API_KEY` | (none) | Chat-driven scenarios skip; eject-only scenarios still run |
| dbt-core (Python pkg) | from `backend` test extras | Suite skips with `probe_dbt_runner_importable` |
| dbt-duckdb (Python pkg) | from `backend` test extras | Suite skips with `probe_dbt_duckdb_loadable` |
| Compose `minio` service | up | Suite skips with `probe_minio_readable_via_duckdb` |

## Adapter coverage (skill Mandate 6)

| Adapter | Real-IO scenario | Covered by |
|---|---|---|
| `dbtRunner` (`dbt.cli.main`) | YES | walking-skeleton (real `dbtRunner` invoke) + milestone-1 + milestone-3 probe 1 + milestone-3 probe 5 |
| `DuckDBProfileSeeder` | YES | walking-skeleton (real seeded profile) + milestone-1 customer-fidelity + milestone-5 export-breakage |
| `ProjectExporter` (HTTP) | YES | walking-skeleton + milestone-3 probe 3 + milestone-4 ADR-016 ingress |
| MinIO (Parquet via httpfs) | YES | walking-skeleton + milestone-3 probe 4 |
| `PanderaValidator` | YES | milestone-2 (real schema, real frame from harness) |
| Filesystem (tmp_path zip extraction) | YES | walking-skeleton + milestone-1 |

## Driving-port discipline

`@when` steps import only from:
- `tests/acceptance/dbt-test-validation/conftest.py` fixtures
- `backend.tests.integration.dataset_layer.harness` (the
  `DatasetLayerHarness` facade)

`@when` steps NEVER import from the orchestrator/seeder/parser/validator
modules directly. The `eject_orchestrator` session fixture is the only
construction site for the orchestrator (composition root invariant —
ADR-019 §4).
