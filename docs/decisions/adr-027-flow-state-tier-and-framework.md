# ADR-027: UI-State Tier as a Dedicated Hono Service; Remix as the FE Framework

**Status:** Accepted (ratified 2026-05-11 — user selected Option D over Option B)
**Date:** 2026-05-11
**Originating wave:** DESIGN — `user-flow-state-machines` (DISCUSS → DESIGN propose-mode)
**Companion artifacts:**
- DISCUSS handoff: `docs/feature/user-flow-state-machines/discuss/handoff-design.md`
- DESIGN application-architecture: `docs/feature/user-flow-state-machines/design/application-architecture.md`
- Sibling ADRs (this wave): ADR-028 (XState v5 actor model), ADR-029 (`active_scope` propagation contract)
- Inherited: ADR-014 (ChatEvent stratification), ADR-015 (presentation-state log precedent), ADR-016 (auth-proxy ingress), ADR-018 (capability-presence dispatch)

## Context

The DISCUSS wave for `user-flow-state-machines` enumerated 8 user flows whose state today is scattered across React Contexts, TanStack Query caches, route params, and a separate `/api/users/me` re-fetch in `AuthContext.tsx`. JOB-002 names the problem: the UI and the headless tests re-derive flow logic in parallel, and they drift. The canonical bug class is the "ChatView project-context race" (named explicitly in Round-2 D9 of `wave-decisions.md`).

Two hard constraints from DISCUSS Round-2 frame the decision space:

1. **D8 — the agent stays the chat brain.** The `agent/` (Hono worker) is dedicated to SSE streaming via Groq + tool dispatch + the ADR-015 directive log. It is NOT a candidate host for flow state machines.
2. **D9 — `active_scope` is load-bearing.** Every flow except login operates inside a specific `active_scope = { org_id, project_id, resource_type?, resource_id? }`. The framework chosen MUST express scope inheritance cleanly without manual per-component plumbing.

React + XState are committed as building blocks; the framework choice is the open variable.

## Decision drivers

- **D8 honored mechanically.** Whichever option ships, the agent is unmodified.
- **D9 expressed by construction.** Manual context plumbing is the failure mode (recapitulating the ChatView race). The chosen propagation mechanism must remove the failure shape, not paper over it.
- **Test parity (JOB-002 O2).** The TS harness and the FE MUST read from the same projection. No parallel state. No FE-internal-only state.
- **Reuse over reinvention.** The repo already has (a) ADR-015's reflect-only directive log (the projection shape); (b) ADR-018's capability-presence dispatch (Redis-or-noop); (c) `RedisThreadPersister` (XADD/XRANGE primitives). The new tier reuses all three under a new vocabulary.
- **Reversibility within ecosystem.** A framework choice that locks the FE into a non-React idiom is rejected.
- **Adapter maturity.** Picking a tool with an unmaintained or absent adapter for our existing stack is rejected.

## Considered options

The DISCUSS handoff (`handoff-design.md`) enumerated 5 options:

1. **A. Vanilla Vite SPA + client-side XState.** State machines in the browser; server does NOT own flow state.
2. **B. New BFF Node service + XState server-side + React SPA reads projection.** Vite stays; React Router stays; new Node tier owns machines.
3. **C. Inertia.js (Hono adapter) + XState server-side.** Server returns `{component, props}`; closest semantic match to the user's "FE reloads after API call → same state as backend" mental model.
4. **D. Remix + XState server-side + new Node tier.** Per-route loaders express scope; React Router replaced; first-class Vite support.
5. **E. Next.js App Router + XState server-side.** Server Components; biggest mental-model shift; biggest payoff.

### Why A is rejected

Option A does not solve the problem JOB-002 names. The server does not own flow state; the UI/test divergence persists; `active_scope` is manually wired through React Context — exactly the shape that drifted in the ChatView race. The "cheapest delta" is also the "cheapest mismatch with the requirement."

### Why C is rejected

The maintained Inertia adapters in 2026-05 are Laravel, Rails, Adonis, Express, and Phoenix. There is no maintained Hono adapter. Adopting Inertia therefore requires one of:
- Maintaining an Inertia-Hono shim ourselves (lock-in risk: every Inertia version bump risks breaking our shim).
- Switching the new tier from Hono to Express (regression on ADR-001's "Hono over Express" decision).
- Switching the new tier off the Inertia adapter family altogether (defeats the purpose of choosing Inertia).

Option D (Remix) achieves the user's stated mental model ("FE reloads after API call → same state as backend") via loaders, with a maintained Vite-integrated framework and no shim risk. C's win condition is reproducible under D with lower adapter risk.

### Why E is rejected

The mental-model shift (Server Components + Server Actions) is the largest of the five options. Vite is replaced by Next.js's bundler. The chat SSE integration needs rework. DISCUSS estimated 6-12 weeks; the JOB-002 outcome is achievable in 4-6 weeks under D with comparable scope-chain ergonomics (parallel routes in E are slightly more ergonomic than nested loaders in D, but the difference is not load-bearing for our scope shape).

### Why B is the runner-up

B is structurally viable and is the smallest topology delta after A is cut. It is held in reserve as the **fallback** if the team chooses to defer Remix migration. ADR-027/028/029 are written to apply to both B and D with the resolver site as the variable (§"Scope-chain expressibility" maps).

### Why D is chosen

- **Scope-chain drift LOW by construction**: `useRouteLoaderData("root").active_scope` is the only legal read path. Alternative paths (`useParams`, `useAuth()`, ad-hoc `fetch`) are flagged at compile time or by lint.
- **Mental-model match**: Remix loaders re-run on every navigation; that IS "FE reloads after API call → same state as backend."
- **Adapter maturity**: Remix v2.7+ has first-class Vite support since 2024. Shopify-owned. MIT.
- **Reversibility**: the load-bearing piece is the ui-state Node tier, which is framework-independent. If Remix becomes a problem, the loaders port to Next.js `app/` route handlers in 1-2 weeks; the tier is unchanged.

## Decision outcome

### 1. The UI-State Tier (NEW Node service)

A new Hono service (`ui-state/`) deploys alongside the agent in the same compose topology. It owns:

- **XState v5 actors** for each user flow (J-001 first; J-002 through J-007 added as DISCUSS passes complete).
- **Per-flow event log** (Redis Streams; key prefix `ui-state:{flow_id}:events`).
- **Projection endpoints**:
  - `GET /api/flows/{flow_id}/projection` — JSON projection of the current flow state.
  - `GET /api/flows/{flow_id}/projection/stream` — SSE push channel for live updates.
  - `POST /api/flows/{flow_id}/events` — append a flow event (e.g., `sign_in_clicked`, `org_form_submitted`).
- **Scope resolver** — pure function `(route, jwt, machineContext) → active_scope`.
- **Replay buffer** for `expired_token` (5s timeout, 16 max queued mutations).
- **Earned-Trust `probe()`** — startup check for Redis, auth-proxy, backend, WorkOS.

The tier is reachable only through auth-proxy (ADR-016). The tier does not own JWT verification — auth-proxy injects identity headers, the tier trusts them (mirrors the existing agent + backend pattern).

### 2. The Frontend Framework

**Remix v2 (with the Remix Vite plugin).** `frontend/main.tsx` and `frontend/App.tsx` are replaced by a Remix routes tree. Vite stays as the build tool. The chat SSE integration is unchanged (the FE component continues to connect to the agent's `/chat` endpoint via the auth-proxy).

Route layouts express `active_scope` inheritance:

- `app/root.tsx` — loader reads the `login-and-org-setup` projection; returns `active_scope` + `user`.
- `app/routes/org.$org.project.$project.tsx` — nested loader; reads `project-session-mgmt` projection; intent values from URL params are reconciled by the ScopeResolver in the tier.
- Any leaf component calls `useRouteLoaderData<typeof rootLoader>("root").active_scope` via a typed `useScope()` helper.

### 3. Persistence

Inherited from ADR-018 verbatim: Redis Streams when `REDIS_URL` is set; noop fallback otherwise. No new env var. Same compose Redis container. New key prefix: `ui-state:{flow_id}:events`. MaxLen parameterized via `FLOW_EVENT_MAXLEN` (default 1000).

**`flow_id` schema (amended per ADR-030 §2.1 — multi-tenant safety):**

- **Per-user flows** (the default case in PR-0): `flow_id = <machine-name>:<principal_id>` (e.g., `ui-state:loginAndOrgSetup:user-001`)
- **Singleton flows** (none in PR-0): `flow_id = <machine-name>` (e.g., `ui-state:globalMaintenance`)

**Rationale:** Per-user flows MUST include `principal_id` to prevent cross-user pollution — a `FREEZE` event broadcast on `ui-state:loginAndOrgSetup:events` would otherwise match every user's login flow. This is a correctness invariant parallel to ADR-029 invariant 1 (org_id matches JWT claim). Discovered during the system-scope DESIGN pass; ratified into the tier contract by ADR-030.

### 4. Projection wire format (JSON)

```ts
type FlowProjection = {
  flow_id: string;                  // e.g., "login-and-org-setup"
  state: string;                    // e.g., "ready" | "authenticating" | "expired_token"
  context: Record<string, unknown>; // machine context — flow-specific shape
  active_scope: ActiveScope;        // ADR-029 contract
  sequence_id: number;              // monotonic per-flow; for SSE replay-from-cursor
  last_event_at: string;            // ISO timestamp
  correlation_id: string;           // current attempt's correlation id
};
```

The FE and the TS harness consume identical JSON. No parallel state. No FE-internal-only field.

### 5. Cross-machine freeze contract (resolves OQ-5 from DISCUSS)

On entry to the `expired_token` state, the `LoginAndOrgSetupMachine` emits a `FREEZE` event through the orchestrator actor; the orchestrator broadcasts `send(FREEZE)` to every spawned child actor (XState v5 actor-model `system.get(...)` enumeration). Each flow machine declares a `FREEZE` handler that pauses outgoing mutations.

The replay buffer:
- Lives in the ui-state tier (NOT the FE).
- Bounded: 5 second wall-clock timeout from FREEZE; 16 max queued mutations per flow.
- Per-mutation entry: `{ flow_id, intent_event, original_correlation_id, queued_at }`.
- Flush on THAW: each queued intent re-sent to its flow with the original `correlation_id`.
- Overflow / timeout: queued mutations are abandoned with a `replay_abandoned` event emitted; the FE/harness can observe this via the projection and surface a UX path (preserve original input in the chat composer per US-005).

### 6. Earned Trust — adapter probes

Per principle 12, every driven adapter has a `probe()`. Composition root invariant: **wire then probe then use**.

| Adapter | Probe assertions | Fault behavior |
|---|---|---|
| `RedisFlowEventLog` | Connect + XADD probe + XRANGE readback + DEL | HARD-fail; `health.startup.refused` |
| `AuthProxyClient` | GET openapi.json; validate `/api/auth/reissue` shape | HARD-fail |
| `WorkOSClient` | GET OIDC discovery | SOFT-fail (warn; `authenticating` degrades to `error_recoverable`) |
| `BackendClient` | GET /api/health; validate openapi.json shape | HARD-fail |

Three-layer enforcement (per principle 12):
- **Subtype**: TypeScript `Probed` interface; composition root signature requires `Probed & FlowEventLog`.
- **Structural**: AST pre-commit hook walks `ui-state/lib/adapters/*.ts`; every export class must have a `probe` method.
- **Behavioral**: CI gold-test runs `npm start --probe-strict`; asserts one `health.probes.passed` event per registered adapter.

`import-linter` was investigated and rejected per principle 12 — its contracts are import-graph-only with no API for method-presence enforcement.

### 7. Architectural enforcement (principle 11)

| Layer | Tool | Rule |
|---|---|---|
| Import graph (tier) | `dependency-cruiser` | `routes/` imports `orchestrator/`; `orchestrator/` imports `machines/`; reverse = build error. |
| Subtype | TypeScript `strict` | All adapter exports satisfy `Probed`. |
| Structural | AST pre-commit (`scripts/check-adapters.ts`) | Every `*Adapter.ts` exports class with `probe()`. |
| Behavioral | CI gold-test (`ui-state/test/composition-root.test.ts`) | Startup emits `health.probes.passed` per adapter. |
| FE Import graph | `dependency-cruiser` | FE may NOT import ui-state internals; only `@dashboard-chat/ui-state-client`. |
| FE Lint | `eslint-plugin-remix` + custom rule | Flag direct `useParams` reads of scope-relevant params. |

## Consequences

### Positive

- JOB-002 outcomes O1 (time to add a flow's headless test), O2 (UI/harness divergence), O3 (one-place transition rule change) become mechanically true.
- The "ChatView project-context race" is impossible by construction in Option D.
- The ui-state tier and the agent share a deployment shape; ops cognitive load is bounded.
- Redis log infrastructure is reused; no new persistence concept.
- ADR-015 (presentation-state log) is the precedent the new vocabulary mirrors; testers familiar with that pattern recognize the shape immediately.
- Reversibility: the load-bearing piece (ui-state tier) is framework-independent; Remix replaceability is bounded to the FE.

### Negative / accepted trade-offs

- One new deployable. Operational delta: +1 container in compose; +1 image in Bazel build graph; +1 Redis key prefix. Mitigated by reusing every primitive.
- React Router → Remix migration is route-by-route work (4-6 weeks engineering). Mitigated by sequencing US-001/US-002 first (the seed implementation), then incremental for downstream flows.
- The `AuthContext.tsx` strangler-fig pattern leaves both surfaces live during the migration window; the team must enforce "new code reads loader data only" via lint. Mitigated by ESLint rule + code review.
- Remix v2 is mature but not as battle-tested as Next.js at large enterprise scale. Mitigated by adapter-maturity check (v2.7+, Vite plugin stable since 2024, Shopify backing).

### Cross-decision composition

- **ADR-027 ↔ ADR-014** — Flow transitions emit `DomainEvent`s (per ADR-014's parallel-unions); UI projections are derived. Cross-machine signals (`FREEZE`, `THAW`) are `DomainEvent`s, NOT `UiDirective`s.
- **ADR-027 ↔ ADR-015** — The flow-event log is the same shape as the directive log under a different vocabulary. The two logs coexist in Redis with distinct key prefixes. The reference reducer in `shared/chat/` is the precedent; this feature ships `shared/ui-state/` alongside.
- **ADR-027 ↔ ADR-016** — The ui-state tier is reachable only through auth-proxy; the compose stack grows from 5 to 6 services; the acceptance compose-mirror test is amended accordingly (`docker-compose.yml` adds the tier; the auth-proxy's forward rules add `/ui-state/*`).
- **ADR-027 ↔ ADR-018** — The capability-presence dispatch pattern is inherited verbatim. The new tier's `selectFlowEventStore` mirrors `selectThreadPersister`. Same env var; same Redis container; same compose acceptance gate.
- **ADR-027 ↔ ADR-028 + ADR-029** — siblings in this wave. ADR-028 ratifies XState v5 actor model as the engine; ADR-029 ratifies the `active_scope` propagation contract. ADR-027 is the topology + framework decision; the others are the engine and the data-flow contracts.

## Open questions

1. **Should the ui-state tier be a Bazel target or a plain npm workspace?** Recommendation: Bazel target (mirrors agent + auth-proxy). Decision deferred to DELIVER kickoff.

2. **Per-org partitioning of the flow-event log.** PR-0 uses per-flow-id keys. If the tier needs to enumerate flows for a single org (e.g., "what flows is this org running?"), a secondary index becomes necessary. Not in this feature's scope; revisit when a consumer asks.

3. **Should the projection endpoint support delta encoding (`?since=sequence_id`)?** PR-0 ships full-state per response (mirrors ADR-015). Deltas are additive; defer until payload size becomes loud.

4. **Migration of `AuthContext.tsx` consumers.** Strangler-fig over 3 PRs: (1) introduce `useScope()`; (2) migrate consumers off `useAuth()`; (3) delete `AuthContext.tsx`. Sequencing detail belongs to DELIVER.

## References

- DISCUSS handoff: `docs/feature/user-flow-state-machines/discuss/handoff-design.md`
- Shared artifacts registry: `docs/feature/user-flow-state-machines/discuss/shared-artifacts-registry.md`
- User stories: `docs/feature/user-flow-state-machines/discuss/user-stories.md`
- Journey contract: `docs/product/journeys/login-and-org-setup.yaml`
- Inherited ADRs: ADR-014, ADR-015, ADR-016, ADR-018
- Sibling ADRs: ADR-028 (XState v5 actor model), ADR-029 (`active_scope` propagation contract)
