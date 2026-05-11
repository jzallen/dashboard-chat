# C4 Diagrams — `dbt-test-validation`

**Feature:** dbt-test-validation
**Wave:** DESIGN
**Date:** 2026-05-08
**Author:** Morgan (nw-solution-architect)

These diagrams describe the chosen Option **β (Layered C+B)**. Where shape would
differ for α (pure C) or γ (sampled-eject) it is annotated inline.

---

## L1 — System Context

The harness is the actor; the SUT is the existing 5-service compose stack
(ADR-016); the in-process `dbtRunner` (Python API from `dbt.cli.main`) +
a fresh DuckDB file are the new artifacts.

```mermaid
C4Context
  title L1 — System Context (dbt-test-validation, Option β)

  Person(harness, "DatasetLayerHarness (pytest)", "Drives chat workflow + ejects + runs dbt")

  System_Boundary(sut, "Compose SUT (ADR-016, 5 services)") {
    System(authproxy, "auth-proxy", "Hono / jose JWT")
    System(backend, "backend", "FastAPI + SQLAlchemy + Ibis")
    System(worker, "worker", "Hono chat / SSE")
    System(qe, "query-engine", "DuckDB compute service")
    SystemDb(minio, "MinIO", "Parquet datalake")
  }

  System_Ext(dbtcli, "dbt-core (Python API: dbtRunner)", "dbt.cli.main; dbt-duckdb 1.9 adapter")
  SystemDb_Ext(duckdb, "Ephemeral DuckDB file", "Per-test tmpdir; reads same MinIO Parquet")

  Rel(harness, authproxy, "Sends prompts via /chat (over JWT)")
  Rel(authproxy, backend, "Forwards authenticated requests")
  Rel(authproxy, worker, "Forwards /chat (SSE)")
  Rel(worker, backend, "Applies transforms via /api/datasets/{id}/transforms")
  Rel(backend, minio, "Reads/writes Parquet via Ibis-on-DuckDB")
  Rel(harness, backend, "GET /api/projects/{id}/export/dbt (zip)", "via auth-proxy")
  Rel(harness, dbtcli, "Invokes `build` then `test` via `dbtRunner.invoke()`")
  Rel(dbtcli, duckdb, "Materializes staging models + runs tests")
  Rel(duckdb, minio, "Reads source Parquet via S3 secret + httpfs", "production-fidelity path")
```

**OQ1 resolution visible above:** the harness-owned DuckDB file is **separate**
from the backend's Ibis-materialized DuckDB. Both read the **same** MinIO
Parquet — that is the bridge that gives "fresh DuckDB seeded with same
Parquet" its production-fidelity property (it is exactly what the customer
will do after they unzip).

---

## L2 — Container Diagram (harness internals + new components)

Zooms inside the harness process. Existing containers are unshaded;
new-this-feature containers are shaded by the `Container_Boundary` they sit in.

```mermaid
C4Container
  title L2 — Container Diagram (Option β harness internals)

  Person(test, "pytest test_dataset_staging_layer.py", "AAA acceptance test")

  Container_Boundary(harness, "DatasetLayerHarness (existing facade)") {
    Container(facade, "DatasetLayerHarness", "Python class", "Orchestrates flow, owns retry budget")
    Container(chatapi, "ChatApi", "Existing wrapper", "POST /chat over SSE")
    Container(transformsapi, "TransformsApi", "Existing wrapper", "POST/PATCH /api/datasets/{id}/transforms")
    Container(datasetsapi, "DatasetsApi", "Existing wrapper", "GET /api/datasets/{id}")
    Container(sessionsapi, "SessionsApi", "Existing wrapper", "GET /api/sessions/{id}/events")
  }

  Container_Boundary(newval, "Validation layer (NEW)") {
    Container(panderav, "PanderaValidator", "Python module", "Per-turn schema check (B's mechanism, β-only)")
    Container(orch, "EjectAndTestOrchestrator", "Python module", "Per-flow gate (C's mechanism)")
    Container(profile, "DuckDBProfileSeeder", "Python module", "Writes ~/.dbt/profiles.yml override into tmpdir")
    Container(runner, "DbtRunner", "Python module", "Wraps `dbtRunner.invoke()` from `dbt.cli.main`; sequences deps/build/test; reads `dbtRunnerResult.result`")
  }

  System_Ext(sut, "Compose SUT (5 services)", "auth-proxy + backend + worker + query-engine + MinIO")
  SystemDb_Ext(tmpdb, "tmpdir/<flow>/duckdb.db", "Per-flow ephemeral DuckDB")

  Rel(test, facade, "async with DatasetLayerHarness(...)")
  Rel(facade, chatapi, "send_turn(prompt)")
  Rel(facade, transformsapi, "post_direct (idempotency tests only)")
  Rel(facade, datasetsapi, "get_table_state()")
  Rel(facade, sessionsapi, "list_session_events()")

  Rel(facade, panderav, "validate_after(dataset_id) [β only]", "<100ms per turn")
  Rel(facade, orch, "eject_and_test(project_id) [β + α + γ]", "30-90s per flow")

  Rel(orch, sut, "GET /api/projects/{id}/export/dbt")
  Rel(orch, profile, "seed_duckdb_profile(tmpdir, minio_creds)")
  Rel(orch, runner, "run_build_and_test(tmpdir)")
  Rel(runner, tmpdb, "writes via dbt-duckdb adapter")
  Rel(profile, tmpdb, "configures target path")

  UpdateRelStyle(facade, panderav, $offsetX="-30")
  UpdateRelStyle(facade, orch, $offsetX="20")
```

**Variant notes:**

* **α (pure C)** — drop `PanderaValidator`. Facade no longer calls it; per-turn
  data assertions go away (only AC1.4 raw-tool-call leak guard at protocol level
  is retained).
* **γ (sampled-eject)** — same containers as β, but the test invokes
  `orch.eject_and_test()` only on a representative subset of flows (registry of
  "regression" flows in `conftest.py`); per-turn Pandera covers density.

---

## L3 — Component Diagram for `EjectAndTestOrchestrator` (NEW substantive component)

The new substantive component. Boundary is the public method
`eject_and_test(project_id) -> EjectTestReport`. Internals are
implementation detail (software-crafter owns them; this diagram is the WHAT).

```mermaid
C4Component
  title L3 — EjectAndTestOrchestrator Components

  Container_Boundary(orch, "EjectAndTestOrchestrator") {
    Component(api, "eject_and_test(project_id) -> EjectTestReport", "Public method", "Single entry point — sequence below")
    Component(exporter, "ProjectExporter (port)", "Calls GET /api/projects/{id}/export/dbt", "Returns zip bytes via existing harness HTTP client")
    Component(unzipper, "ZipExtractor", "Pure utility", "Extracts to tmpdir; verifies expected files (dbt_project.yml, profiles.yml, models/staging/*.sql)")
    Component(seeder, "DuckDBProfileSeeder", "Writes profiles.yml override", "Injects S3 endpoint + creds for MinIO; targets tmpdir/duckdb.db")
    Component(runner, "DbtRunner", "Python-API driver", "Sequences `dbtRunner.invoke(['deps'])` → `invoke(['build'])` → `invoke(['test'])`; captures each `dbtRunnerResult`")
    Component(parser, "RunResultsParser", "Pure utility", "Translates `dbtRunnerResult.result` -> EjectTestReport (status, model count, test count, failures); falls back to `target/run_results.json` only if `.result` is None")
    Component(probe, "probe()", "Earned-Trust contract", "Pre-flight: confirms `dbt.cli.main.dbtRunner` is importable + version >= 1.8, dbt-duckdb adapter loads, MinIO is reachable from a fresh DuckDB connection, and `dbtRunnerResult.result` shape matches what `RunResultsParser` expects")
  }

  ContainerDb_Ext(tmpdb, "tmpdir/duckdb.db", "Ephemeral")
  System_Ext(backend, "backend (export endpoint)")
  System_Ext(minio, "MinIO (Parquet sources)")

  Rel(api, exporter, "1. fetch zip")
  Rel(exporter, backend, "GET /api/projects/{id}/export/dbt")
  Rel(api, unzipper, "2. unzip + verify tree")
  Rel(api, seeder, "3. seed profile")
  Rel(api, runner, "4. dbtRunner.invoke(['deps']) then ['build'] then ['test']")
  Rel(runner, tmpdb, "materializes staging models")
  Rel(runner, minio, "via httpfs; same Parquet backend uses", "production-fidelity")
  Rel(api, parser, "5. parse dbtRunnerResult.result")
  Rel(api, probe, "0. probe() before first use")
```

**Earned-Trust note (principle 12):** `probe()` is **not optional**. The
composition root for the orchestrator (a session-scoped pytest fixture)
invokes `probe()` once. Failure → `pytest.skip("eject-orchestrator probe
failed: <reason>")` rather than allowing the suite to run with a silently
broken dependency. The probe must specifically exercise:

1. `from dbt.cli.main import dbtRunner` succeeds AND
   `dbtRunner().invoke(['--version']).success` is `True` AND the reported
   version is `>= 1.8`.
2. `dbt-duckdb` adapter import succeeds (`import dbt.adapters.duckdb`).
3. A throwaway DuckDB connection in tmpdir can `INSTALL httpfs; LOAD httpfs;`
   and `SELECT count(*) FROM read_parquet('s3://...')` against MinIO using the
   same credentials that get baked into the seeded profile. **This catches the
   class of substrate lies that makes Option C dangerous: a profile that
   compiles but cannot read sources at runtime.**
4. `dbtRunner().invoke(['parse', '--project-dir', <probe>])` returns a
   `dbtRunnerResult` whose `.result` exposes the attributes
   `RunResultsParser` reads — pinning the dbt-side surface that dbt
   explicitly documents as "not fully contracted."

If the probe is omitted or stubbed, the suite passes trivially when MinIO
auth is broken — exactly the failure mode JOB-001 says we must not have.

---

## Sequence — One Regression Flow End-to-End (Option β)

Shows the order and where Pandera (per-turn, β only) interleaves with the
post-flow eject-and-test. AC1.4 raw-tool-call leak guard stays at the protocol
level; data assertions are split across the two layers per OQ5.

```mermaid
sequenceDiagram
    autonumber
    participant T as pytest test
    participant H as DatasetLayerHarness
    participant P as PanderaValidator (β)
    participant SUT as Compose SUT
    participant O as EjectAndTestOrchestrator
    participant DBT as dbtRunner (in-process)
    participant DDB as tmpdir DuckDB
    participant MIN as MinIO

    T->>H: async with DatasetLayerHarness(...)
    T->>H: upload_csv("ecommerce-orders.csv")
    H->>SUT: POST /api/uploads + register dataset
    SUT-->>H: dataset_id

    loop For each chat op (e.g. "standardize region to title case")
      T->>H: chat_turn(prompt, dataset_id)
      H->>SUT: POST /chat (SSE, dev JWT)
      SUT-->>H: ChatEventTrace (turn_done)
      Note over H: AC1.4 raw_tool_call_seen MUST stay False<br/>(protocol-level guard, retained)
      opt β only: per-turn fast feedback
        T->>P: validate_after(dataset_id, schema=OrdersStaging)
        P->>SUT: GET /api/datasets/{id}?preview_limit=100
        SUT-->>P: TableState
        P-->>T: ValidationResult (<100ms)
        Note over P: Surfaces LLM jitter / wrong column<br/>BEFORE flow completes
      end
    end

    Note over T,O: After ALL chat ops complete — per-flow durable gate
    T->>O: eject_and_test(project_id)
    O->>O: probe() (first call only; cached for session)
    O->>SUT: GET /api/projects/{id}/export/dbt
    SUT-->>O: zip bytes (200 application/zip)
    O->>O: unzip to tmpdir; verify tree
    O->>O: seed profiles.yml (S3 endpoint + creds → tmpdir/duckdb.db)
    O->>DBT: dbtRunner.invoke(['deps', '--project-dir', tmpdir])
    DBT-->>O: dbtRunnerResult (.success=True)
    O->>DBT: dbtRunner.invoke(['build', '--project-dir', tmpdir, '--profiles-dir', tmpdir])
    DBT->>DDB: CREATE TABLE stg_orders AS (compiled CTEs)
    DDB->>MIN: read_parquet('s3://datalake/datasets/<proj>/<ds>/...')
    MIN-->>DDB: rows
    DBT-->>O: dbtRunnerResult (.result = list[RunResult])
    O->>DBT: dbtRunner.invoke(['test', '--project-dir', tmpdir, '--profiles-dir', tmpdir])
    DBT->>DDB: run dbt generic tests (not_null, unique, accepted_values, ...)
    DDB-->>DBT: test results
    DBT-->>O: dbtRunnerResult (.result, .success)
    O->>O: parse .result -> EjectTestReport
    O-->>T: EjectTestReport (status, failures)
    T->>T: assert report.status == "pass"

    Note over T,DDB: tmpdir cleaned by pytest tmp_path teardown
```

**Wall-clock budget check (OQ4):**

* Single regression flow today: 10 chat ops × ~7s = ~70s for the chat phase
  (per evolution doc §6).
* Eject phase per flow: zip download (~200ms), unzip (~50ms), profile seed
  (~10ms), `dbtRunner.invoke(['deps'])` (cached after first run; ~2s cold /
  ~50ms warm), `dbtRunner.invoke(['build'])` + `invoke(['test'])` (~10–30s on
  a single staging model with ~250 rows; saves ~50–200ms per call vs
  subprocess fork/exec).
* **Total per regression flow: ~85–105s. AC1.6 (300s) holds with ~65% headroom**
  against today's single-flow scenario. **If a second regression flow lands**,
  margin tightens; γ (sampled-eject) becomes the contingency at that point.

---

## Production-fidelity invariants (ADR-016 inheritance)

The compose stack STAYS at 5 services. The eject orchestrator runs OUTSIDE
the compose network — it is a peer of the harness, not a service on the
network. The existing prod-topology guarantees are unaffected:

* All ingress to backend/worker still flows through auth-proxy.
* `TRUST_PROXY_HEADERS=true` branch is still the one tests exercise.
* No new service is added to docker-compose; the orchestrator is in-process
  to pytest and invokes `dbt-core` via the `dbtRunner` Python API
  (`dbt.cli.main`) — also in-process. (`dbtRunner` is not safe for
  concurrent calls within one process — fine for serial pytest and for
  pytest-xdist's per-worker process isolation; documented constraint.)

This is the key reason α/β/γ all pass the ADR-016 hard constraint — none of
them touches the topology of the SUT.
