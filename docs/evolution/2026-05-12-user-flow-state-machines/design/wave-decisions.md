# Wave Decisions — DESIGN — `user-flow-state-machines`

> **Wave**: DESIGN (propose mode)
> **Date**: 2026-05-11
> **Architect**: Morgan (nw-solution-architect)
> **Inherited from DISCUSS**: 11 artifacts under `docs/feature/user-flow-state-machines/discuss/`
> **Inherited constraints**: D8 (agent stays the chat brain), D9 (scope chain is load-bearing), React+XState committed.
> **Companion deliverables**: `application-architecture.md`, `handoff-design-to-distill.md`, ADR-027, ADR-028, ADR-029.

---

## D1 — Interaction mode

**Propose**. Per orchestrator instruction. Five-option matrix narrowed to two
survivors with explicit cuts. One recommendation made with explicit rationale.

## D2 — Inherited hard constraints (non-negotiable)

| # | Source | Constraint |
|---|---|---|
| C1 | DISCUSS D8 | The `agent/` (Hono worker) is the chat brain only. The ui-state-machine layer does NOT live there. |
| C2 | DISCUSS D9 | `active_scope = { org_id, project_id, resource_type?, resource_id? }` must flow through every render/API/agent call without manual per-component plumbing. |
| C3 | DISCUSS commitment | React + XState are committed building blocks. The framework choice is the open variable. |
| C4 | ADR-014 | ChatEvent vocabulary stratified; transitions emit `DomainEvent`, UI renders from projection. |
| C5 | ADR-015 | Reflect-only directive log is the precedent shape; this feature generalizes it from one-log-per-channel to N-machines-per-flow. |
| C6 | ADR-016 | Auth-proxy is the sole ingress for backend + worker; the new tier composes with this topology, never bypasses it. |
| C7 | ADR-018 | Capability-presence dispatch (`REDIS_URL` set → Redis tier; unset → noop) is the persistence backend pattern. The new tier reuses this dispatch shape verbatim. |

## D3 — Reuse Analysis (MANDATORY — skill-enforced gate)

| Existing component | Path | Reuse decision | Rationale |
|---|---|---|---|
| `InProcessPresentationStateLog` / `RedisPresentationStateLog` | `agent/lib/chat/presentationState.ts` + `redisPresentationState.ts` | **Pattern reuse, NOT extend** | The append-only `UiDirective[]` log is the *shape* the ui-state-machine projection mirrors. We do NOT extend it (that would mix domain events with directives, violating ADR-014). We replicate the pattern under a new vocabulary (`FlowEvent[]`). |
| `selectThreadPersister` capability-presence dispatch | `agent/lib/chat/threadPersisterDispatch.ts` | **Pattern reuse** | The dispatch shape (`REDIS_URL` set → Redis; unset → noop) is verbatim reused for `selectFlowEventStore`. No new env var. |
| `RedisThreadPersister` (XADD/XRANGE writer) | `agent/lib/chat/redisThreadPersister.ts` | **Adapter precedent** | The flow-event log uses identical Redis Streams primitives. The implementation is independent (different key prefix, different schema), but the integration shape (lazyConnect, maxRetriesPerRequest, maxLen) is the precedent. |
| `presentationStateRoutes.ts` (Hono sub-app exposing the log) | `agent/lib/chat/presentationStateRoutes.ts` | **Cannot reuse — wrong host** | This sub-app lives in `agent/`, which D8 has fenced off. The ui-state-machine tier exposes its own equivalent route handler in its own host. |
| `auth-proxy/app.ts` (Hono on Node, sole production ingress) | `auth-proxy/app.ts` | **Considered as host — REJECTED** | The auth-proxy's responsibility is JWT verification + identity-header injection. Adding stateful flow-machine ownership to it would muddle two concerns (auth ingress vs flow orchestration) and create a hot-path stateful service where the existing one is stateless. The auth-proxy stays as it is. |
| `backend/tests/integration/dataset_layer/harness.py` (`DatasetLayerHarness`) | same | **Compose alongside, NOT duplicate** | This Python harness is the JOB-001 backend+agent contract guard. The new TS `UserFlowHarness` is the JOB-002 user-flow surface. Both read from the SAME projection endpoint (the flow-event log + projection). Composition: a JOB-001 acceptance test can call the TS harness for auth+org setup and then call the Python harness for chat-turn validation. No duplication — different responsibilities. |
| `AuthContext.tsx` / `AuthProvider.tsx` (React Context for token + user state) | `frontend/src/ui/context/AuthContext/` | **Strangler-fig replace** | This is the precise re-derivation surface the feature aims to remove. Phase-1 of US-001 keeps it; phase-2 migrates consumers to read `state.user` from the flow projection; phase-3 deletes the context. Sequenced in `migration-plan.md` (DELIVER). |
| `App.tsx` (React Router v6 routes; `RequireAuth` / `RequireOrg` guards) | `frontend/App.tsx` | **Replace with route-loader-shaped guards** | The route guards currently derive `isAuthenticated` + `user?.org_id` from React Context. In the recommended option, route loaders own this resolution server-side. React Router stays; the guards' implementation moves from context-read to loader-data-read. |
| `ChatView/index.tsx` reads `projectId` from useParams + an effect that fetches project metadata | `frontend/src/ui/components/ChatView/index.tsx` | **Migration target — the canonical drift case** | The "ChatView project-context race" the user named in Round-2 is the canonical bug class this feature retires. ChatView reads `active_scope.project_id` from the projection; no useParams-then-fetch. |
| Backend `POST /api/orgs`, `POST /api/auth/callback`, `POST /api/auth/reissue` (if it exists; otherwise add) | `backend/app/routers/` | **Behind-port consumers** | The ui-state-machine tier invokes these as ordinary HTTP clients. No backend change required for US-001/US-002 except possibly adding an idempotent JWT-reissue endpoint (US-002 AC). That endpoint is a small backend ADR-shaped delta; this feature's design names the contract; the implementation is a backend leaf. |

**Reuse summary**: every infrastructure pattern this feature needs already exists in the codebase under a different vocabulary. The work is **lifting the pattern** (ADR-015's directive log + ADR-018's capability-presence dispatch) **to a new vocabulary** (flow events + projections), not building new primitives. **Net new infrastructure: one Node tier, one Redis key prefix, one route family. Everything else is precedent.**

## D4 — Survivors of the 5-option matrix

| Option | Status | Rationale |
|---|---|---|
| A. Vanilla SPA + client-side XState | **CUT** | Does not solve JOB-002 (server still does not own flow state). On scope-chain expressibility it scores HIGH drift risk — this is the exact shape that produced the ChatView project-context race the user named. The cheapest delta is the cheapest mismatch. |
| B. New BFF Node service + XState server-side + React SPA reads projection | **SURVIVOR ("Option B")** | Smallest topology delta after the cut of A. Vite SPA stays; React Router stays; one new Node tier. Scope flows through projection, but FE still wires it manually at every component. |
| C. Inertia.js (Hono adapter) + XState server-side | **CUT** | The Hono Inertia adapter (`@inertiajs/server` does not have a Hono variant in 2026-05; the maintained adapters are Laravel/Rails/Adonis/Express/Phoenix). Picking Inertia requires either (a) maintaining an Inertia-Hono shim ourselves, (b) introducing Express, or (c) moving the new tier off Hono. Each path adds lock-in risk for an unproven adapter combination. The user's "FE reloads after API call → same state as backend" mental model can be met by Option D's loader pattern with less lock-in. |
| D. Remix + XState server-side | **SURVIVOR ("Option D")** | Largest mental-model match to "FE reloads after API call → same state as backend" within React + Vite ecosystem. Loaders run on every navigation; the loader IS the ui-state-projection read. `useRouteLoaderData` expresses scope inheritance cleanly. Compatible with Vite (Remix has first-class Vite support since v2.7). |
| E. Next.js App Router + XState server-side | **CUT** | Biggest mental-model shift (Server Components + Server Actions). Replaces Vite. The frontend SSE/streaming integration (chat) requires rework. Effort 6-12 weeks (per DISCUSS estimate) is disproportionate to the JOB-002 outcome given two cheaper options remain. The parallel-routes ergonomic win exists but is not load-bearing for our scope shape. |

**Two survivors**: **B (new Node BFF)** and **D (Remix)**.

## D5 — Other DESIGN-wave decisions

### D5a — XState version

**XState v5 with the actor model.** v5 is the current major (since 2024); the actor model is the v5 idiom and is required for the **cross-machine `expired_token` freeze semantics** (US-005). Each machine becomes an actor; a parent orchestrator can `send` a `FREEZE` event to all child actors atomically. This is materially cleaner than v4's hand-rolled cross-machine plumbing.

ADR-028 ratifies XState v5 with actor model.

### D5b — Persistence backend

**Redis Streams via capability-presence dispatch** (mirrors ADR-018 verbatim). Same env var (`REDIS_URL`), same Tier 1/Tier 2 split, same Redis container in compose. New key prefix (`ui-state:{flow_id}:events`); maxLen parameterized identically. **No new infra; no new ADR for persistence** — ADR-018's policy is inherited by reference.

### D5c — Projection wire format

**Per-flow JSON projection endpoint**, structured as:

```
GET /api/flows/{flow_id}/projection
→ { flow_id, state, context, last_event_at, sequence_id, active_scope }
```

For live updates: **SSE push channel** mirroring ADR-015's pattern (`GET /api/flows/{flow_id}/projection/stream`). FE consumes the SSE in the recommended option; the harness consumes the GET form. Both read the same projection shape — no schema drift.

ADR-027 ratifies the projection contract.

### D5d — `active_scope` propagation contract

**Server-side resolution at route entry, propagated via route loader data (Option D) or via projection header (Option B fallback).** Schema is a single TypeScript type re-exported into Python via codegen. ADR-029 ratifies the contract.

### D5e — Cross-machine `expired_token` freeze + replay-buffer contract

**Single `AuthMachine` actor is the freeze emitter; every other flow actor declares a `FREEZE`/`THAW` handler that pauses outgoing mutations**. Replay buffer is bounded (5s timeout, 16 max queued mutations) and lives in the ui-state tier (not the FE). ADR-027 §"Cross-machine freeze" specifies the contract.

## D6 — Recommendation

**Option D (Remix) is the recommended choice.** Single sharpest argument: it is the **smallest framework choice that mechanically eliminates** the scope-chain drift class (`useRouteLoaderData` is the entry point; every nested layout reads scope from there; the FE has no other path). Option B preserves more of the current frontend at the cost of perpetuating manual scope wiring; this is the wiring that produced the ChatView race. The user's stated mental model ("FE reloads after API call → same state as backend") is also a closer match to Remix loaders than to a polled projection.

**Effort estimate**: 4–6 weeks engineering, +/- 1 week (lower than DISCUSS's "4–8 weeks" estimate because (a) the Redis log infra and capability-dispatch pattern are already in place; (b) the C4 boundary changes are local — no new container types, just a new Node tier sharing the agent's deployment shape; (c) the scope-resolver lives at one place by construction).

**If Option B is chosen instead** (e.g., because the team wants to minimize React-Router-to-Remix migration risk): the architecture is structurally compatible, the same ADRs apply with §"Resolver site" amendments, and migration to D later is non-destructive (Remix can read from the same projection endpoint Option B's SPA reads from).

## D7 — Tech stack additions

| Component | Library | License | Version | Maturity |
|---|---|---|---|---|
| State-machine engine | XState (`xstate@^5`) | MIT | 5.x | Mature; 5+ years; active maintenance |
| Web framework (new ui-state tier) | Hono (`hono@^4`) | MIT | 4.x | Already in repo (agent, auth-proxy); zero new dependency risk |
| (If Option D ratified) FE framework | Remix (`@remix-run/react@^2`) + Vite plugin | MIT | 2.7+ | First-class Vite support since 2024 |
| Persistence (Tier 1) | ioredis (`ioredis`) | MIT | already vendored | Same client the agent uses for `RedisThreadPersister` |
| Test harness | Vitest + `@dashboard-chat/shared-chat` types | MIT | already vendored | No new test framework |

**OSS-first verification**: all five additions are OSS, all MIT-licensed. No proprietary tech proposed. No "best practice" justification — each choice is mapped to a constraint above.

## D8 — Constraints carried forward to DISTILL

| # | Constraint | Effect on acceptance tests |
|---|---|---|
| T1 | The ui-state tier is reachable via `auth-proxy` only | Acceptance tests route through auth-proxy port; no direct hit to the ui-state tier's port. |
| T2 | Projection endpoint is the shared SSOT between FE and TS harness | A test that asserts FE behavior MUST also be asserted via the projection endpoint; divergence is a test failure (one-way mock). |
| T3 | `active_scope` is read from projection only, never from URL params | Tests that simulate "stale URL → fresh scope" assert that the scope resolver wins. |
| T4 | XState v5 actor model is the cross-machine signaling layer | The `FREEZE` test scenario for US-005 exercises the actor-tree pattern, not a hand-rolled pub/sub. |

## D9 — Upstream changes (vs DISCUSS)

| Discuss assumption | Status | Change | Where documented |
|---|---|---|---|
| Inertia.js was the user's signaled lean | **Reframed, not overridden** | Inertia is cut for adapter-maturity reasons. The user's underlying preference (SSR-shaped + scope-via-shared-props) is honored by Option D (Remix), which expresses the same idea via loaders. | `application-architecture.md` §"Option C cut" + `upstream-changes.md` |
| OQ-2 ("what runs the machines") was deferred from DISCUSS | **Resolved here** | XState v5 actor model. | ADR-028 |
| OQ-5 (cross-machine freeze) was deferred from DISCUSS | **Resolved here** | Actor-tree FREEZE/THAW; bounded replay buffer in ui-state tier. | ADR-027 §"Cross-machine freeze" |
| OQ-7 (WCAG `role="alertdialog"`) | Carried to DELIVER | This is an implementation-level concern; not an architectural decision. | Noted in `handoff-design-to-distill.md` |

No DISCUSS story is invalidated. US-001 through US-005 land exactly as written, with implementation details now ratified.

---

## System Decisions (appended by Titan — system-scope pass, 2026-05-11)

Morgan's decisions D1–D9 above set the application-scope architecture. Titan's system-scope pass adds SD1–SD8 below, addressing topology, scaling, observability, deployment surface, and the frontend tier's process model.

### SD1 — Topology placement (resolves SQ-1)

**The ui-state tier sits behind auth-proxy.** Auth-proxy gains a multi-upstream routing table:

| Path prefix | Upstream |
|---|---|
| `/api/auth/*` | auth-proxy local |
| `/ui-state/*` | ui-state tier (NEW) |
| `/api/*` | backend (existing default) |
| `/worker/*` | (future — out of PR-0 scope; agent currently reached via frontend nginx) |

Ratified in ADR-030.

**Sharpest argument**: ADR-016 declares auth-proxy the sole ingress for privileged operations. The ui-state tier mutates state (writes FlowEvents, invokes backend POSTs); it must sit behind auth-proxy. Co-tenanting in auth-proxy was rejected (mirrors the D8 rejection of `agent/` as host — auth-proxy does one thing well; ui-state is hot and stateful). Routing through frontend nginx was rejected (bypasses auth-proxy; contradicts ADR-016).

### SD2 — Scaling shape (resolves SQ-2)

**Single replica.** XState v5 actors are in-process; multi-replica requires either cross-process actor coordination (Redis pub/sub re-implementation of `system.get(actor).send(FREEZE)`) or sticky routing. Back-of-envelope estimation (`system-architecture.md` §0) shows a single 256MB container handles 10x load (1,000 concurrent users, 3,000 active actors) with 2-3 orders of magnitude headroom on RAM, CPU, Redis QPS, and projection QPS.

Scaling-ceiling triggers documented in ADR-030 §3. Migration to Option γ (sticky multi-replica): pre-costed at 1-2 weeks engineering when triggered.

### SD3 — Persistence (resolves SQ-3 — directive, no new ADR)

**Redis Streams via ADR-018 inheritance** — exactly as Morgan specified. Contract spec made explicit:

- Key prefix: `ui-state:{flow_id}:events` where `flow_id = <machine-name>:<principal_id>` for per-user flows (multi-tenant safety; amends ADR-027 §3).
- XADD per transition; full machine context snapshot every 50 events.
- Probe contract: XADD/XRANGE/DEL round-trip on startup; HARD-fail if any step fails.
- Snapshot fast-path (`ui-state:{id}:snapshot` Redis String) is an additive optimization deferred to DELIVER if projection-build cost exceeds budget.

### SD4 — Observability (resolves SQ-4 — directive, folded into ADR-030)

- **Per-transition stdout JSON** at INFO level: one record per transition with full context (machine_id, from_state, to_state, sequence_id, correlation_id, principal_id, org_id, duration_ms).
- **FREEZE/THAW** get their own event names (`flow.freeze.broadcast`, `flow.thaw.broadcast`).
- **Health endpoints**: `/health`, `/health/probes`, `/health/actors` (aggregate counts only — no per-user enumeration).
- **Metrics**: derived from logs by external aggregator (Vector/Promtail/equivalent). NO in-tier metrics endpoint at PR-0.
- **OpenTelemetry**: DEFERRED — system-wide decision, not feature-local.
- **Correlation-id propagation**: MANDATORY — every request, every outgoing call, every FlowEvent record carries `X-Correlation-Id`.

### SD5 — Frontend tier transition (resolves SQ-5)

**Remix runs alongside nginx, NOT in place of it.** nginx in the existing `frontend` container is byte-unchanged. A NEW container `ui-presentation` runs Remix's Node server. nginx gains one new rule (`location ~ ^/(login|org)(/|$)` → `ui-presentation:3001`); existing rules including ADR-015's load-bearing `/api/channels/:id/presentation-state` rule are preserved verbatim.

Strangler-fig migration: one route family per PR. Rollback per route is a one-line nginx.conf revert. Ratified in ADR-031.

**Sharpest argument**: nginx does four routing things today, plus gzip, caching, and late-binding DNS resolution. Replacing it with Remix's Node server is unnecessary churn with no system-level benefit. ADR-015's routing rule is load-bearing and must not be lost.

### SD6 — Auth path (resolves SQ-6 — derives from SD1 + SD5 + ADR-016)

- Browser sends Bearer token; nginx forwards to `ui-presentation`; Remix loaders forward to auth-proxy; auth-proxy verifies; auth-proxy injects identity headers; ui-state tier trusts headers (no double verification).
- Cookie migration deferred to Phase B (post-feature, separate ADR when needed).

### SD7 — Failover / SPOF (resolves SQ-7 — derives from SD2)

| Component | Is it a NEW SPOF for this feature? | MTTR |
|---|---|---|
| ui-state tier | YES — but ONLY for sign-in + scope transitions | ~30s (container restart + lazy Redis rehydration on first projection read) |
| Redis | NO — already a SPOF for ADR-018 + ADR-015. Blast radius grows: 3 logs now share one Redis. | unchanged |
| auth-proxy | NO — already a SPOF per ADR-016 | unchanged |
| backend (api) | NO | n/a |
| agent | NO — fully decoupled per Morgan's D8 | n/a |

Existing flows (chat, dataset operations) are UNAFFECTED by ui-state outages. Verified in compose acceptance test (`docker compose restart ui-state` mid-flow → recovery <60s).

### SD8 — Estimation (resolves SQ-8 — see `system-architecture.md` §0)

| Metric | 1x (100 users) | 10x (1,000 users) |
|---|---|---|
| Active actors | 300 | 3,000 |
| Tier RAM | ~155 MB | ~195 MB |
| Tier CPU (1 core) | <1% | ~5% |
| Redis XADD/sec | 100 | 1,000 |
| Redis storage | 150 MB | 1.5 GB |
| Projection endpoint QPS | 8 | 83 |
| SSE connections | 100 | 1,000 |
| **Replicas needed** | **1** | **1** |

**One replica handles 10x load with orders-of-magnitude headroom on every dimension.** Scaling is triggered by ceiling alarms, not planned capacity.

### Cross-reference to new ADRs

| Decision | ADR |
|---|---|
| SD1, SD2, SD4, SD7, SD8 (and amends ADR-027 §3's `flow_id` schema) | ADR-030 (Topology + Scaling) |
| SD5 | ADR-031 (Frontend tier transition) |
| SD3 | (no new ADR — ADR-018 inheritance + contract spec in `system-architecture.md` §2) |
| SD6 | (no new ADR — derives from SD1 + SD5 + existing ADR-016) |

### Pushbacks on Morgan's design (documented in `upstream-changes.md`)

1. Container diagram implied Remix replaces nginx; system-scope pass clarifies separate container (ADR-031).
2. "Auth-proxy is sole ingress" is aspirational today — agent currently bypasses via frontend nginx. ADR-030 documents this and routes the new tier correctly from day 1.
3. `flow_id` schema in ADR-027 §3 was multi-tenant-unsafe — amended to mandate `principal_id`.
4. Replica count was implicit in Morgan's design — made explicit as single-replica with documented ceiling.
5. Compose acceptance count: not "5+1=6" but "5+2=7" (ui-presentation is its own container).
