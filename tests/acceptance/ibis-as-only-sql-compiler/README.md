# Acceptance — ibis-as-only-sql-compiler (ADR-026 MR-1)

This directory carries the executable acceptance contracts for ADR-026
MR-1 — `ViewIbisCompiler` replacing `ViewSQLGenerator`. The contracts
mirror the BDD scenarios in
`docs/feature/ibis-as-only-sql-compiler/distill/`; per DWD-2 this is a
NEW suite with its own `pyproject.toml`, not an extension of
`tests/acceptance/dbt-test-validation-v2/`.

## Coverage matrix

| Scenario | File | Asserts |
|---|---|---|
| Walking skeleton (DWD-3) | `test_walking_skeleton.py` | WHERE clause in compiled SQL + dbt eject + row equivalence vs fixture |
| M1 SELECT-FROM-JOIN-WHERE | `test_milestone_1_structure.py` | Multi-source join + filter compose into well-formed SQL |
| M1 injection vector (DWD-4) | `test_milestone_1_injection.py` | Hostile value round-trips as escaped literal; zero rows |
| M1 operator outline (12 ops) | `test_milestone_1_operators.py` | Every filter operator renders + evaluates correctly |
| M1 dbt eject equivalence | `test_milestone_1_dbt_eject.py` | Intermediate model rows == in-system view rows |
| M1 malformed operator | `test_milestone_1_malformed_operator.py` | Unknown operator → 4xx, no view persisted |

## Strategy

Strategy C — real local + skip-when-unavailable (DWD-1). The suite drives
the production HTTP API through the compose stack's auth-proxy and uses
in-memory DuckDB for row-level evaluation. When the compose stack is not
reachable the session-scoped `requires_compose_stack` fixture skips the
suite with a named reason.

## Running

The 5-service compose stack must be up:

```bash
docker compose up -d
```

Then from the repo root:

```bash
./tools/test/test.sh --acceptance=ibis-as-only-sql-compiler
```

Or from this directory directly:

```bash
cd tests/acceptance/ibis-as-only-sql-compiler
uv sync --group dev
uv run --no-project pytest -v
```

## Skip-when-unavailable env vars

| Env var | Default | Effect when absent |
|---|---|---|
| `AUTH_PROXY_URL` | `http://localhost:1042` | Suite skips with "compose stack not reachable" |

## Phases after MR-1

`docs/feature/ibis-as-only-sql-compiler/distill/roadmap.json` Phase 02
(MR-2: ibis-source plugin) and Phase 03 (MR-3: `ReportIbisCompiler`)
both extend this suite. MR-2 adds **no new scenarios** — the
walking-skeleton + dbt-eject equivalence already cover the customer-
visible invariant. MR-3 adds 5 milestone-2 scenarios for the report
tier.
