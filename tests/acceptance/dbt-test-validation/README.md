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
- `milestone-5-failure-modes.feature` — testing-inversion safety
  (export breakage) + retry exhaustion. `@pending`.

> Milestone 4 (AC1.4 raw-tool-call leak guard + ADR-016 ingress URL
> invariant) was reclassified out of this suite to
> `backend/tests/integration/dataset_layer/protocol_invariants/` per
> ADR-024 Phase 2 — those invariants are chat-protocol-shaped, not
> data-shaped.
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
| `ProjectExporter` (HTTP) | YES | walking-skeleton + milestone-3 probe 3 (ADR-016 ingress moved to `backend/tests/integration/dataset_layer/protocol_invariants/`) |
| MinIO (Parquet via httpfs) | YES | walking-skeleton + milestone-3 probe 4 |
| `PanderaValidator` | YES | milestone-2 (real schema, real frame from harness) |
| Filesystem (tmp_path zip extraction) | YES | walking-skeleton + milestone-1 |

## Behavioral enforcement (ADR-019 §"Earned-Trust contract")

ADR-019 §4 defines three orthogonal enforcement layers for the probe
contract:

| Layer | Mechanism |
|---|---|
| Subtype | `mypy` + `EjectOrchestratorProtocol` (`backend/tests/integration/dataset_layer/eject/protocols.py`) |
| Structural | `pytest-archon` rule (deferred to a follow-up wave; tracked in DWD-10) |
| Behavioral | `test_behavioral_enforcement.py` |

`test_behavioral_enforcement.py` is a single in-process pytest test
that sabotages probe 1's substrate (`monkeypatch.delattr(dbt.cli.main,
"dbtRunner")`), constructs a fresh `EjectAndTestOrchestrator`, calls
`await orchestrator.probe(tmp_path)`, and asserts the resulting
`ProbeSummary` carries `ok=False` with `probe_dbt_runner_importable` in
its `failures` list. It then mirrors the conftest's
`eject_orchestrator` fixture's skip-message construction format and
asserts the failing-probe name surfaces in that string. Without this
test, a probe that silently regressed to `ok=True` under a broken
substrate would let the entire suite green falsely — the test is the
behavioral guardrail on the meta-property "broken substrate produces a
named, structured failure".

Run it alongside the rest of the acceptance suite:

```bash
cd tests/acceptance/dbt-test-validation
AUTH_PROXY_URL=http://localhost:3000 AGENT_URL=http://localhost:8787 \
  uv run --project . pytest test_behavioral_enforcement.py
```

It is part of the standard acceptance suite, not a separate CI job: a
contributor's pre-push run of the suite (and CI's run of the same)
includes this test by default. The same `requires_compose_stack`
gating applies, so a contributor laptop without `docker compose up`
sees a graceful skip rather than a confusing failure.

## Driving-port discipline

`@when` steps import only from:
- `tests/acceptance/dbt-test-validation/conftest.py` fixtures
- `backend.tests.integration.dataset_layer.harness` (the
  `DatasetLayerHarness` facade)

`@when` steps NEVER import from the orchestrator/seeder/parser/validator
modules directly. The `eject_orchestrator` session fixture is the only
construction site for the orchestrator (composition root invariant —
ADR-019 §4).
