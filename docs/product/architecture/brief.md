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

This section accumulates system-scope architectural decisions: topology,
scaling, observability, deployment surface, persistence substrates, and
infrastructure-level concerns. Each feature's DESIGN wave (system-scope
pass) appends a sub-heading. Bootstrapped 2026-05-11 by Titan
(nw-system-designer) when the first system-architecture-shaped feature
ran DESIGN.

### Constraint inheritance (system-scope)

| Source | Constraint | Effect on system architecture |
|---|---|---|
| ADR-001 | Hono over Express for new Node services | All new Node tiers ship on Hono; no per-service framework re-litigation |
| ADR-016 | Auth-proxy is the sole production ingress (for backend; aspirational for agent today) | New privileged-operation tiers MUST route through auth-proxy; the door is documented for future migration of `/worker/*` to also route through auth-proxy |
| ADR-018 | Capability-presence dispatch — `REDIS_URL` set → Redis tier; unset → noop fallback | All new tiers that need durable replay reuse this dispatch shape verbatim; no new env-var conventions |
| ADR-015 | nginx routing rule `/api/channels/:id/presentation-state` → agent direct (load-bearing for ADR-015's directive log) | Must be preserved through any frontend tier transition; ADR-031 honors this |

### Current container topology (as of 2026-05-11)

| Container | Role | Stateful? | Replica count | Host port |
|---|---|---|---|---|
| `frontend` | nginx — static SPA + reverse-proxy router | No (config-driven) | 1 (fixed host port) | 5173:80 |
| `auth-proxy` | Hono — JWT verification + identity-header injection | Stateless (keypair on volume) | 1+ (scalable; pending shared secrets) | 1042:3000 |
| `agent` | Hono + Groq SDK — chat brain | In-process presentation-state log; Redis-backed when configured | 1 (fixed host port; ADR-018) | 1041:8787 |
| `api` (backend) | FastAPI + SQLAlchemy + Ibis — dataset + project state | Yes (SQLite/PG + Redis read for session log) | 1 | 8000:8000 |
| `redis` | Redis 7 — append-only log substrate for 2 (soon 3) key prefixes | Yes (volume-backed) | 1 | 6379:6379 |
| `minio` | S3-compatible object store — Parquet datalake | Yes | 1 | 9000:9000 |
| `query-engine` | pg_duckdb — DuckDB compute | Yes | 1 | 5433:5432 |

The frontend's nginx is the de-facto multi-upstream router today (proxies `/api/` to auth-proxy; `/worker/` to agent direct; `/api/channels/:id/presentation-state` to agent direct per ADR-015). Auth-proxy is single-upstream today (`BACKEND_URL` only); this changes for new tiers per ADR-030.

### System-architecture features

#### `user-flow-state-machines` (DESIGN — 2026-05-11 — system-scope pass)

**Author:** Titan (nw-system-designer)
**ADRs:** ADR-030 (topology + scaling, Proposed), ADR-031 (frontend tier transition, Proposed)
**Companion (application-scope):** Morgan's ADR-027/028/029
**Feature design:** `docs/feature/user-flow-state-machines/design/{system-architecture.md, application-architecture.md, wave-decisions.md, upstream-changes.md}`
**Status:** Proposed → awaiting system-designer-reviewer + user ratification of single-replica + multi-upstream auth-proxy → DISTILL

**Topology decision summary.** The new flow-state tier sits **behind auth-proxy**, which gains a multi-upstream routing table (`/api/auth/*` → local; `/flow-state/*` → flow-state; `/api/*` → backend; future `/worker/*` → agent). Auth-proxy keeps its single concern (auth verification + identity injection); it gains a path-prefix routing layer (~30 lines of Hono routes + tests). The flow-state tier is the first tier to be routed through auth-proxy for privileged operations, honoring ADR-016 from day 1 (the agent's bypass is documented as a pre-existing inconsistency).

**Scaling decision summary.** The flow-state tier deploys as **exactly one replica** in compose (fixed host port `1043:8788`, mirroring the agent's pattern). XState v5's in-process actor model precludes cross-replica FREEZE/THAW without Redis pub/sub re-implementation; back-of-envelope estimation shows a single 256MB container handles 10x load (1,000 concurrent users; 3,000 active actors; 1,000 Redis XADDs/sec) with 2-3 orders of magnitude headroom on every dimension. Scaling-ceiling triggers (CPU>60%, RAM>200MB, actors>10K, SLO target >99.5%) are documented; migration to multi-replica sticky-routing (Option γ) is pre-costed at 1-2 weeks.

**Persistence stance.** Redis Streams via ADR-018 inheritance. New key prefix `flow:{flow_id}:events` where `flow_id = <machine-name>:<principal_id>` for per-user flows (mandatory for multi-tenant safety). XADD per transition; snapshot every 50 events. Probe contract: XADD/XRANGE/DEL round-trip; HARD-fail at startup if Redis is unreachable. Redis blast radius grows: three key prefixes (`flow:`, `session:`, `presentation-state:`) now share one Redis container — operator runbook should add Redis HA before the next service joins the substrate.

**Frontend tier transition.** A NEW `frontend-remix` container runs Remix's Node server alongside the existing nginx-static `frontend` container. nginx is byte-unchanged except for one new upstream rule for migrated routes (`/login`, `/org/$org` in PR-0). The strangler-fig migration runs one route family per PR; rollback per route is a one-line nginx.conf revert. ADR-015's load-bearing `/api/channels/:id/presentation-state` rule is preserved verbatim.

**New containers introduced:**

| Container | Role | Replica | Host port |
|---|---|---|---|
| `flow-state` | Hono + XState v5 — flow-state machines, projection endpoints | 1 (mandatory) | 1043:8788 |
| `frontend-remix` | Remix v2 on Node — server-side route loaders for migrated routes | 1 | (internal only; not exposed) |

Compose acceptance stack grows from 5 services (ADR-016) to **7 services** (+`flow-state`, +`frontend-remix`).

**Observability stance.** Per-transition structured JSON to stdout (event=`flow.transition`, with machine_id, from_state, to_state, sequence_id, correlation_id, principal_id, org_id, duration_ms). FREEZE/THAW emit their own events (`flow.freeze.broadcast`, `flow.thaw.broadcast`). Health endpoints: `/health`, `/health/probes`, `/health/actors` (aggregate counts only). Metrics derived from logs by external aggregator; no in-tier metrics endpoint at PR-0. OpenTelemetry deferred — system-wide decision, not feature-local. Correlation-ID propagation MANDATORY on every request, every outgoing call, every FlowEvent record.

**SPOF assessment.** The flow-state tier is a SPOF for sign-in + scope transitions (MTTR ~30s on crash; lazy Redis rehydration on first projection read). It is NOT a SPOF for chat (agent independent), dataset operations (backend independent), or any other in-progress flow. Failover verified in compose acceptance test (`docker compose restart flow-state` mid-flow → recovery <60s). No NEW SPOF compared to today's stack; existing SPOFs (Redis, auth-proxy, backend) are inherited.

**Quality gates passed (this DESIGN wave, system-scope pass).**

- [x] Topology decision with explicit options + trade-offs (`system-architecture.md` §1).
- [x] Scaling shape decision driven by back-of-envelope estimation (`system-architecture.md` §0).
- [x] Persistence substrate inheritance ratified + contract spec extended (multi-tenant `flow_id`).
- [x] Observability surface specified (events + health + metrics + correlation-id).
- [x] Frontend tier transition with strangler-fig migration path (ADR-031).
- [x] Updated C4 Container diagram in Mermaid (`system-architecture.md` §8).
- [x] Deployment diagram (`flowchart TB`) showing replicas + routing + sticky-vs-round-robin (`system-architecture.md` §9).
- [x] Top-3 system risks identified for DEVOPS handoff (`system-architecture.md` §12).
- [x] Pushbacks on Morgan's design documented (`upstream-changes.md` Changes 9-13).
- [ ] Peer review pending (`system-designer-reviewer`).

### Cross-section index (system-scope ADRs)

| ADR | Summary |
|---|---|
| ADR-001 | Hono over Express for new Node services |
| ADR-015 | nginx routes presentation-state log to agent direct (load-bearing) |
| ADR-016 | Auth-proxy sole production ingress (for backend; aspirational for agent today) |
| ADR-017 | SessionEventReader capability-presence dispatch (superseded by ADR-018) |
| ADR-018 | Redis-only SessionEventReader (supersedes ADR-017) |
| ADR-030 | Flow-state tier topology + single-replica scaling (Proposed) |
| ADR-031 | Frontend tier transition — Remix alongside nginx, not replacing (Proposed) |

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

### `user-flow-state-machines` (DESIGN — 2026-05-11)

**Author:** Morgan (nw-solution-architect)
**ADRs:** ADR-027 (host + framework, Proposed), ADR-028 (XState v5 actor model, Proposed), ADR-029 (`active_scope` propagation contract, Proposed)
**JOB:** JOB-002 (`docs/product/jobs.yaml`)
**DISCUSS source:** `docs/feature/user-flow-state-machines/discuss/` (11 artifacts; Round-2-extended)
**DESIGN deliverables:** `docs/feature/user-flow-state-machines/design/{wave-decisions.md, application-architecture.md, handoff-design-to-distill.md, upstream-changes.md}`
**Status:** Proposed → awaiting solution-architect-reviewer (Atlas) + user ratification of Option D vs B → DISTILL

**Decision summary.** Introduce a NEW Hono Node tier (`flow-state/`), peer to the agent in compose, that owns XState v5 actor-tree flow machines and exposes per-flow JSON projections at `GET /api/flows/{flow_id}/projection`. Recommend **Remix v2** as the FE framework (Option D from DISCUSS's 5-option matrix); **Option B** (BFF + plain SPA, React Router stays) is the structural fallback. Five-option matrix narrowed to two survivors (B + D); A, C, E cut with documented rationale (see ADR-027).

**New components introduced:**

| Component | Role | Location (planned) |
|---|---|---|
| Flow-State Tier | NEW Hono service hosting XState v5 actor tree; owns flow machines, projection endpoints, scope resolver, replay buffer | `flow-state/` (new top-level workspace) |
| `LoginAndOrgSetupMachine` | Seed XState v5 actor implementing J-001 (US-001 through US-005) | `flow-state/lib/machines/loginAndOrgSetup.ts` |
| `FlowOrchestrator` | Root actor; spawns + supervises flow machines; broadcasts FREEZE/THAW | `flow-state/lib/orchestrator.ts` |
| `ScopeResolver` | Pure function `(route, jwt, machineContext) → ActiveScope`; enforces ADR-029 invariants | `flow-state/lib/scope/resolver.ts` |
| `RedisFlowEventLog` | Adapter satisfying `FlowEventLog` port; Redis Streams (XADD/XRANGE); `flow:{id}:events` key prefix | `flow-state/lib/adapters/redisFlowEventLog.ts` |
| `ReplayBuffer` | Bounded queue (5s timeout, 16 max); flushed on THAW | `flow-state/lib/orchestrator/replayBuffer.ts` |
| `UserFlowHarness` (TS) | First-class TS harness for J-001 flows; reads same projection FE consumes | `tests/acceptance/user-flow-state-machines/harness/UserFlowHarness.ts` |
| Remix FE migration (if Option D ratified) | Replace `frontend/main.tsx` + `App.tsx` with Remix routes tree; `useScope()` helper backed by `useRouteLoaderData` | `frontend/app/` (Remix convention) |
| `<ScopeProvider>` (if Option B ratified) | React Context + TanStack-Query-backed projection consumer | `frontend/src/scope/ScopeProvider.tsx` |

**Integration points (new):**

| Integration | Direction | Contract |
|---|---|---|
| Auth-proxy → Flow-State Tier | `/flow-state/*` forward rules | Auth-proxy injects identity headers + `X-Correlation-Id`; tier trusts them. No new auth surface. |
| Flow-State Tier → Backend | `POST /api/orgs`, `POST /api/auth/reissue` (verify present; small backend delta if absent) | OpenAPI-contract-validated in CI. |
| Flow-State Tier → WorkOS | OIDC token exchange during `authenticating` transitions | **Contract test recommended** (Pact-JS) for response shape pinning. |
| Flow-State Tier → Redis | XADD `flow:{id}:events`; XRANGE for projection fold | Capability-presence dispatched (ADR-018 inheritance); same Redis container. |
| FE / Harness → Flow-State Tier (via auth-proxy) | `GET /api/flows/{id}/projection`, `POST /api/flows/{id}/events`, SSE `/projection/stream` | JSON projection schema in ADR-027 §4. |
| Agent (chat brain — unchanged) | Receives `X-Active-Scope` header from auth-proxy on every chat turn | Per ADR-029 §"Agent integration contract"; D8 honored (agent does not derive scope; it receives). |

**External integrations annotated for DEVOPS handoff:**

> Contract tests recommended for Flow-State Tier → WorkOS — consumer-driven contracts via Pact-JS in CI acceptance stage. Internal contracts (auth-proxy, backend) covered by their existing OpenAPI documents; tier's mock-server validates against those specs.

**Earned-Trust contract.** Every adapter satisfies a `Probed` TypeScript interface. Composition-root invariant: **wire then probe then use**. Probes:
- `RedisFlowEventLog`: XADD/XRANGE/DEL round-trip on startup.
- `AuthProxyClient`: validate openapi.json shape; verify `/api/auth/reissue` present.
- `BackendClient`: health endpoint; validate openapi.json.
- `WorkOSClient`: OIDC discovery (SOFT-fail; degrades `authenticating` to `error_recoverable`).
Probe failure for HARD adapters → process exits with `health.startup.refused` structured event.

**Architectural enforcement (principle 11).** Three semantically orthogonal layers in the tier: (a) TypeScript `Probed` interface + composition-root subtype check; (b) AST pre-commit hook walking `*Adapter.ts` files; (c) CI gold-test exercising probe round-trip at startup. `dependency-cruiser` for import-graph rules. `eslint-plugin-dashboard-chat-flow-state` (custom) flags direct `useParams` reads of scope-relevant params on the FE.

**Quality gates passed (this DESIGN wave).**

- [x] Requirements traced to components (US-001..005 → machines + projections + harness; ACs map to projection invariants).
- [x] Component boundaries with clear responsibilities (C4 L3 diagram in `application-architecture.md` §3).
- [x] Technology choices in ADRs with alternatives (ADR-027 cuts A/C/E; ADR-028 cuts v4 + studio; ADR-029 cuts per-component fetch).
- [x] Quality attributes addressed (ISO 25010 table in `application-architecture.md` §7).
- [x] Dependency-inversion compliance (ports/adapters with capability-presence dispatch; `Probed` injection at composition root).
- [x] C4 diagrams L1+L2+L3 in Mermaid.
- [x] Integration patterns specified (auth-proxy → tier; tier → Redis/backend/WorkOS).
- [x] OSS preference validated (XState MIT; Remix MIT; Hono MIT; all permissive).
- [x] AC behavioral, not implementation-coupled (US-001..005 ACs are projection-state assertions, not internal-class assertions).
- [x] External integrations annotated with contract test recommendation (WorkOS).
- [x] Architectural enforcement tooling recommended (three-layer per principle 11+12).
- [ ] Peer review pending (Atlas — `solution-architect-reviewer`).
- [ ] User ratification of Option D vs Option B pending.

---

## Cross-section index

| ADR | Section | Summary |
|---|---|---|
| ADR-007 | System | Ibis for SQL generation |
| ADR-013 | Methodology | nwave adoption |
| ADR-014 | Application | ChatEvent stratification |
| ADR-015 | Application | Presentation-state log |
| ADR-016 | System | 5-service compose stack |
| ADR-017 | System | SessionEventReader dispatch (superseded) |
| ADR-018 | System | Redis-only SessionEventReader (supersedes 017) |
| ADR-019 | Application | Eject-then-test validation (Proposed) |
| ADR-024 | Application | Rebalance dbt-test-validation (Proposed; partially supersedes 019) |
| ADR-027 | Application | Flow-state tier + Remix framework (Proposed) |
| ADR-028 | Application | XState v5 with actor model (Proposed) |
| ADR-029 | Application | `active_scope` propagation contract (Proposed) |
| ADR-030 | System | Flow-state tier topology + single-replica scaling (Proposed) |
| ADR-031 | System | Frontend tier transition — Remix alongside nginx (Proposed) |
