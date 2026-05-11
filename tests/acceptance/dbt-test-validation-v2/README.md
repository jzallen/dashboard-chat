# Acceptance — dbt-test-validation v2 (ADR-024)

This directory is the v2 home for the `dbt-test-validation` acceptance
suite. It replaces the v1 BDD+orchestrator surface
(`tests/acceptance/dbt-test-validation/`) with a single procedural
driver (~400 LOC) plus five procedure-shaped pytest scenarios:

| Scenario | File | Asserts |
|---|---|---|
| Walking skeleton (DR-3) | `test_walking_skeleton.py` | `models_built >= 1 AND tests_run >= 1` |
| M1.1 — happy path | `test_m1_happy_path.py` | dbt build+test exits green |
| M1.2 — drift detector | `test_m1_drift_detector.py` | A named `not_null` test fails |
| M1.3 — customer fidelity | `test_m1_customer_fidelity.py` | Seeded bucket / endpoint mirror the running stack |
| M5.1 — env-var rejection | `test_m5_env_var_rejection.py` | Unset env_var() raises `EnvVarMissingError` naming the variable |

The v1 suite stays running unchanged until Phase 4 (DR-2). The v2
suite is purely additive in Phase 1.

## Why no BDD, no orchestrator

ADR-024 + the spike at `spike/dbt-test-driver-simplification` showed
that a single procedural driver collapses the v1 BDD-facade +
session-scoped `EjectAndTestOrchestrator` (probes + seeder + runner +
parser) into ~400 LOC while preserving the customer-fidelity contracts.
Substrate lies surface inline at the call site of each driver primitive
instead of via a session-scoped probe pass (DR-4).

## Running

The 5-service compose stack must be up:

```bash
docker compose up -d
```

Then from the repo root:

```bash
./tools/test/test.sh --acceptance=dbt-test-validation-v2
```

Or from this directory directly:

```bash
cd tests/acceptance/dbt-test-validation-v2
uv sync --group dev
uv run --no-project pytest -v
```

## Skip-when-unavailable env vars

| Env var | Default | Effect when absent |
|---|---|---|
| `AUTH_PROXY_URL` | `http://localhost:1042` | Suite skips with "compose stack not reachable" |
| `S3_BUCKET` | `dashboard-chat.datalake` | Used as `seeded_profile_bucket`; the customer-fidelity test compares this to the backend env |
| `S3_ENDPOINT` | `http://localhost:9000` | Used as `seeded_profile_endpoint` |
| `S3_ACCESS_KEY_ID` | `minioadmin` | Substituted into the exported profile |
| `S3_SECRET_ACCESS_KEY` | `minioadmin` | Substituted into the exported profile |
| `S3_USE_SSL` | `false` | Substituted into the exported profile |

dbt-core + dbt-duckdb are declared as dev-group deps in `pyproject.toml`
so a missing dbt install surfaces at collection time with a clear
ImportError, not silently.

## After Phase 4

Per DR-2, after the v1 suite retires this directory IS the only
acceptance home for the dbt-test feature. The `-v2` suffix survives
only during transition (Phases 1-4); a post-Phase-4 rename MR is
optional and cheap.
