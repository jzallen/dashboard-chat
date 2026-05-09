# Architecture Brief — Dashboard Chat

**Status:** Living document — bootstrapped 2026-05-08
**Owners:**
- Application architecture: nw-solution-architect (current author: Morgan)
- System / domain / infrastructure architecture: future architects extend below

This brief is the SSOT root for architectural decisions across waves. Each
architect appends to their own section; ADRs in `docs/decisions/` are the
ratified atoms this document indexes. Prior architect sections are absent
because this is the first DESIGN-wave architectural feature to bootstrap the
brief.

---

## System Architecture

*(Bootstrapped by Titan when the first system-architecture-shaped feature
runs DESIGN. Currently absent — the codebase already has ADRs 001–016
ratifying the system topology piecemeal; a consolidated bootstrap is a
future concern.)*

---

## Domain Model

*(Bootstrapped by Hera when the first domain-modeling-shaped feature runs
DESIGN. Currently absent — the existing taxonomy `dataset` / `view` /
`report` is documented inline in ADR-015's "Naming discipline" section.)*

---

## Application Architecture

This section accumulates application-level architectural decisions. Each
feature's DESIGN wave appends a sub-heading.

### Constraint inheritance

| Source | Constraint | Effect on this brief |
|---|---|---|
| ADR-007 | Ibis is the SQL generator (DuckDB + PostgreSQL dialects) | All transform pipelines compile through Ibis at runtime; eject-time path uses dbt-compiled SQL against the same Parquet sources. |
| ADR-014 | ChatEvent vocabulary is stratified into `DomainEvent` and `UiDirective` parallel unions in `shared/chat/events.ts` | Test infrastructure that asserts on chat events imports from the appropriate sub-union; new chat-event types are out of scope for application-architecture decisions unless an ADR amends ADR-014. |
| ADR-015 | Headless presentation-state retrieval via reflect-only directive log | Available to any feature that needs to assert on table presentation state. |
| ADR-016 | The integration-test compose stack mirrors production topology — 5 services (auth-proxy + backend + worker + query-engine + MinIO) | Any new component that participates in test acceptance MUST run outside the compose network OR justify a topology change with its own ADR. |
| ADR-017 | SessionEventReader uses capability-presence dispatch (Stream.io > Redis > noop) | Independent of validation-shaped features. |

### Component boundaries (current)

* **Frontend** (`frontend/`) — React 18 + Vite + TanStack Query/Table.
  Renders chat-driven directives via `applyDirective` (ADR-015 reference
  reducer in `shared/chat/`).
* **Worker** (`worker/`, also `agent/`) — Hono SSE chat API. Emits typed
  `ChatEvent`s per ADR-014. Persists `DomainEvent`s for replay (ADR-017).
* **Backend** (`backend/`) — FastAPI + SQLAlchemy + Ibis-on-DuckDB. Owns
  dataset state, transforms, project resources, and the
  `dbt-project-export` artifact pipeline.
* **auth-proxy** (`auth-proxy/`) — Hono + jose. Sole production ingress
  for backend and worker (ADR-016).
* **MinIO** — S3-compatible object store; the canonical Parquet datalake.
* **query-engine** — DuckDB compute service, used by the backend for
  preview materialization.
* **Redis** (added by ADR-017 epic F.2) — durable session-event log when
  Stream.io is unconfigured.

### Test architecture

* **DatasetLayerHarness** (`backend/tests/integration/dataset_layer/`) —
  the canonical integration-test entry point for chat-driven dataset
  workflows. Runs against the 5-service compose stack (ADR-016). Owns
  retry-with-rephrase budget (AC1.5) and protocol-level invariants
  (AC1.4). Its facade is the surface other validation layers attach to.
* **Per-flow validation** (planned, ADR-019): the
  `EjectAndTestOrchestrator` invokes `dbtRunner.invoke()` (Python API
  from `dbt.cli.main`) for `deps`/`build`/`test` against the
  customer-fidelity export.
* **Per-turn validation** (planned, ADR-019): a Pandera layer for fast
  feedback on staging-data shape.

### Application-architecture features

#### `dbt-test-validation` (DESIGN — 2026-05-08)

**Author:** Morgan (nw-solution-architect)
**ADR:** ADR-019 (Proposed)
**JOB:** JOB-001 (`docs/product/jobs.yaml`)
**Status:** Awaiting peer review (Atlas) → DELIVER

**Decision summary.** Realize Option C (Eject-then-test) as **Option β
(Layered C+B)** — per-turn Pandera schema validation under a per-flow
eject-and-test customer-fidelity gate. Two layers, one concept (validation),
with the eject step doubling as a drift detector between the SSOTs.

**New components introduced (test infrastructure only — no runtime code):**

| Component | Role | Location (planned) |
|---|---|---|
| `EjectAndTestOrchestrator` | Orchestrates `fetch zip → unzip → seed → dbtRunner.invoke() → parse dbtRunnerResult.result` | `backend/tests/integration/dataset_layer/eject/` |
| `DuckDBProfileSeeder` | Writes a concrete `profiles.yml` overriding the export's `env_var(...)` placeholders for MinIO | same package |
| `DbtRunner` | Wraps `dbtRunner.invoke()` from `dbt.cli.main` (Python API; stable since dbt 1.5); sequences `deps`/`build`/`test` as in-process calls | same package |
| `RunResultsParser` | Translates `dbtRunnerResult.result` (list of `RunResult` from `dbt.cli.main`) into a structured `EjectTestReport`; falls back to `target/run_results.json` only if `.result` is `None` | same package |
| `PanderaValidator` | Per-turn schema check against `TableState.df` | `backend/tests/integration/dataset_layer/validation/` |

**Integration points (new):**

| Integration | Direction | Contract |
|---|---|---|
| Harness → backend export endpoint | `GET /api/projects/{id}/export/dbt` (existing) | application/zip body; verified at `probe()` time |
| Harness → dbt-core (Python API) | `dbtRunner().invoke(['deps'/'build'/'test'])` from `dbt.cli.main` | `dbtRunnerResult.success` + `.result` (list of `RunResult`); **contract test recommended** against pinned dbt versions (1.8, 1.9) — dbt documents `.result` as "not fully contracted" |
| dbt → MinIO | `read_parquet('s3://...')` via httpfs (production-fidelity path) | seeded profile must let DuckDB authenticate; `probe()` exercises this exact path |

**External integrations annotated for DEVOPS handoff:**

> Contract tests recommended for the `dbt-core` ↔ `RunResultsParser` boundary
> — consumer-driven contract (golden-fixture style is sufficient; Pact is
> overkill) pinned against the supported dbt versions. Catches upstream
> shape drift on minor-version bumps before a feature-branch upgrade
> green-passes a parser that silently misses failures.

**Earned-Trust contract.** `EjectAndTestOrchestrator.probe()` is mandatory
and is invoked exactly once per pytest session by a session-scoped fixture.
Probes 1–5 are enumerated in ADR-019. Composition root invariant: **wire then
probe then use**. Probe failure → `pytest.skip(reason)`.

**Architectural enforcement (principle 11).**

* `mypy` + `typing.Protocol` (`EjectOrchestratorProtocol` requires
  `probe()`) — subtype layer.
* `pytest-archon` rule: tests importing the orchestrator MUST also import
  the `eject_orchestrator` fixture — structural layer.
* CI gold-test that uninstalls `dbt-core` (or monkeypatches
  `dbt.cli.main.dbtRunner` to raise `ImportError`) and asserts the suite
  skips with the expected probe-failure reason — behavioral layer.
* `import-linter` config in `backend/`: forbids `backend/app/**` from
  importing `dbt`, `dbt.adapters.duckdb`, or `pandera` — these are test
  extras only.

**Quality gates passed (this DESIGN wave).**

- [x] Requirements traced to components (JOB-001 → β layers → orchestrator + Pandera).
- [x] Component boundaries with clear responsibilities.
- [x] Technology choices in ADR-019 with alternatives.
- [x] Quality attributes addressed (see design.md §9).
- [x] Dependency-inversion compliance (orchestrator behind a Protocol;
      probing fixture is the composition root).
- [x] C4 diagrams (L1+L2+L3 + sequence) in Mermaid.
- [x] Integration patterns specified.
- [x] OSS preference validated (dbt-core + dbt-duckdb + pandera; all
      Apache-2.0 / MIT).
- [x] AC behavioral, not implementation-coupled.
- [x] External integrations annotated with contract test recommendation.
- [x] Architectural enforcement tooling recommended.
- [ ] Peer review pending (Atlas — `solution-architect-reviewer`).

---

## Cross-section index

| ADR | Section | Summary |
|---|---|---|
| ADR-007 | System | Ibis for SQL generation |
| ADR-013 | Methodology | nwave adoption |
| ADR-014 | Application | ChatEvent stratification |
| ADR-015 | Application | Presentation-state log |
| ADR-016 | System | 5-service compose stack |
| ADR-017 | System | SessionEventReader dispatch |
| ADR-019 | Application | Eject-then-test validation (Proposed) |
