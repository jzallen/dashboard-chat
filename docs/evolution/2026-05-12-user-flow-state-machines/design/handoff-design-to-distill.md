# DESIGN → DISTILL Handoff — `user-flow-state-machines`

> **Wave**: DESIGN → DISTILL
> **Date**: 2026-05-11
> **From**: Morgan (nw-solution-architect)
> **To**: acceptance-designer (Quinn, DISTILL wave)
> **Status**: ADRs proposed; awaiting orchestrator ratification before DELIVER. DISTILL may proceed in parallel using the proposed ADRs as the contract.

---

## TL;DR

DESIGN ratified:
- **Topology**: new Hono Node tier (`flow-state/`), reachable via auth-proxy only. The agent is unchanged (D8 honored).
- **FE framework**: **Remix v2** (Option D) with Vite. Option B (BFF + plain SPA) is the structural fallback if the team defers Remix migration.
- **Engine**: XState v5 with the actor model. Cross-machine FREEZE/THAW is the actor-tree broadcast pattern.
- **Persistence**: Redis Streams, capability-presence dispatch inherited from ADR-018. No new env var.
- **Wire format**: JSON projection at `GET /api/flows/{id}/projection`; SSE push at `/projection/stream`.
- **Scope contract**: `ActiveScope` typed object, server-resolved at the route boundary, propagated via `useRouteLoaderData("root")` (Option D) or `<ScopeProvider>` (Option B).

Three ADRs proposed:
- **ADR-027**: flow-state tier + framework decision.
- **ADR-028**: XState v5 actor model.
- **ADR-029**: `active_scope` propagation contract.

---

## What DISTILL inherits — non-negotiable contracts

### 1. Endpoints to assert against

| Endpoint | Owner | Used by |
|---|---|---|
| `POST /api/flows/{flow_id}/events` | Flow-State Tier | FE (Option D loader actions, Option B `useMutation`), TS harness |
| `GET /api/flows/{flow_id}/projection` | Flow-State Tier | FE (loaders), TS harness, acceptance tests |
| `GET /api/flows/{flow_id}/projection/stream` | Flow-State Tier | FE live updates (SSE) |
| `POST /api/auth/reissue` (if not already present) | Backend or auth-proxy | Flow-State Tier (during `creating_org → ready` JWT re-issue) |
| Existing: `POST /api/orgs` | Backend | Flow-State Tier |
| Existing: WorkOS OIDC token exchange | WorkOS (external) | Flow-State Tier |

### 2. ActiveScope schema (ADR-029)

```ts
type ActiveScope = {
  org_id: string;
  project_id: string | null;
  resource_type: "dataset" | "view" | "report" | null;
  resource_id: string | null;
};
```

ADR-029's invariants 1–5 are the **acceptance-test boundary** for the scope contract:
1. `active_scope.org_id` equals JWT's `org_id` claim — divergence is 403 with named diagnostic.
2. `active_scope.project_id` is non-null when the flow's state requires a project.
3. `(resource_type === null) ↔ (resource_id === null)`.
4. Cross-tenant access is 403 with named diagnostic.
5. Stale-link reconciliation emits a `scope_reconciled` FlowEvent.

### 3. Flow events (initial vocabulary — extensible)

```
sign_in_clicked              (US-001)
auth_callback_resolved       (US-001)
org_form_submitted           (US-002)
org_created_and_jwt_reissued (US-002)
validation_failed            (US-002, US-003 negative branch)
transient_failure            (US-003)
retry_clicked                (US-003)
token_expired                (US-005)
silent_reauth_ok             (US-005)
silent_reauth_failed         (US-005)
FREEZE                       (US-005 cross-machine, internal — orchestrator-emitted)
THAW                         (US-005 cross-machine, internal — orchestrator-emitted)
scope_reconciled             (ADR-029 invariant 5)
```

### 4. Projection shape (ADR-027 §4)

```ts
type FlowProjection = {
  flow_id: string;
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
};
```

The TS harness asserts on this shape. The FE renders from this shape. **No FE-internal-only field is acceptable in an acceptance test.**

### 5. TS UserFlowHarness public surface (US-004)

```ts
await harness.user_flow.begin_auth("maya")
await harness.user_flow.submit_org("Acme Data")
await harness.user_flow.assert_state("ready")
await harness.user_flow.force_transient_failure("jwks_not_warm")
await harness.user_flow.assert_jwt_carries_org_claim()
await harness.user_flow.expire_token()
await harness.user_flow.assert_scope({ org_id: "...", project_id: "..." })
```

These are the minimum public methods for J-001. Adding a persona is a one-file change in fixtures.

---

## Acceptance-test seeds — Gherkin scenarios per story

The DISCUSS wave embedded Gherkin in `user-stories.md` (5 stories, ~22 scenarios). Those scenarios are the seeds; DISTILL translates them into runnable BDD tests with these mappings:

| Story | Gherkin location | Test target |
|---|---|---|
| US-001 | `user-stories.md` US-001 §UAT Scenarios | `tests/acceptance/user-flow-state-machines/test_us001_new_user_welcome.py` |
| US-002 | `user-stories.md` US-002 §UAT Scenarios (7 scenarios incl. Round-2 deep-link + agent contract) | `tests/acceptance/user-flow-state-machines/test_us002_org_setup_and_scope.py` |
| US-003 | `user-stories.md` US-003 §UAT Scenarios | `tests/acceptance/user-flow-state-machines/test_us003_recoverable_error.py` |
| US-004 | `user-stories.md` US-004 §UAT Scenarios (7 scenarios incl. Round-2 scope-assertion) | `tests/acceptance/user-flow-state-machines/test_us004_harness_surface.py` |
| US-005 | `user-stories.md` US-005 §UAT Scenarios | `tests/acceptance/user-flow-state-machines/test_us005_expired_token_replay.py` |

The journey-level `@property`-tagged invariants (IC-1 through IC-6 in `journey-login-and-org-setup.yaml`) belong as their own test file:

`tests/acceptance/user-flow-state-machines/test_journey_invariants.py`

These run against the same harness; they're the cross-state contracts (e.g., "correlation_id threads from auth-proxy through the FE log for any attempt") that any future flow's tests must also satisfy.

---

## Implementation paradigm guidance

DELIVER will write code in two paradigms:

1. **TypeScript / functional** (flow-state tier + Remix FE). Pure functions for scope-resolver and projection-builder. XState actors are the side-effect boundary; their `invoke` calls hit adapters that satisfy the `Probed` interface. Composition over inheritance throughout.
2. **TypeScript / functional** (TS harness). Vitest. Adapters mocked at the port boundary via XState's `.provide({ actors: { ... } })` injection.

No backend or Python changes are required for US-001/US-002 except the possible addition of `POST /api/auth/reissue` (idempotent JWT re-issue). If that endpoint already exists, no backend ADR is needed. DISTILL should verify by spike or by reading `backend/app/routers/auth.py`.

---

## Sequencing — what to test first

**Carpaccio slice 1**: US-001 end-to-end via TS harness. Acceptance test:
1. `harness.user_flow.begin_auth("maya")` → projection shows `authenticated_no_org`.
2. State equals `authenticated_no_org`; `state.user.email = "maya.chen@acme-data.example"`.

This drives:
- Flow-State Tier scaffold (one machine, one orchestrator, one event log adapter, one route file).
- Redis dispatch (capability-presence; falls back to noop in unit tests).
- `Probed` interface across adapters with stub probes.
- TS harness scaffold + the `begin_auth` and `assert_state` calls.

**Carpaccio slice 2**: US-002 happy path + project-chip-on-first-paint deep-link.
- Adds: `creating_org` state, scope resolver invariants, Remix root loader.
- Brings in: the FE migration. (If team chooses Option B, this becomes the ScopeProvider integration instead — same test, different propagation primitive.)

**Carpaccio slice 3**: US-003 recoverable-error UI + correlation-id threading.

**Carpaccio slice 4**: US-005 cross-machine FREEZE/THAW. This is the most novel slice; XState v5 actor-tree pattern is exercised end-to-end.

**Carpaccio slice 5**: US-004 harness surface. Some assertions exist by slice 1 (`assert_state`, `assert_scope`); others (`force_transient_failure`, `expire_token`) land here.

---

## Open items DISTILL may surface for the user

| # | Item | Severity | Why |
|---|---|---|---|
| O1 | Whether `POST /api/auth/reissue` already exists in the backend | LOW | A spike-read of `backend/app/routers/auth.py` resolves this in 10 minutes. If absent, the endpoint is a backend ADR-shaped delta (small). |
| O2 | Whether the user ratifies Option D or selects Option B | HIGH | Materially affects the FE migration scope. ADR-027 is written for either; the difference is the propagation primitive in §"Decision outcome / 2 + 3". |
| O3 | Whether to ship the `eslint-plugin-dashboard-chat-flow-state` custom rule in the same MR as the first machine | MEDIUM | Without the lint, drift can creep in during the migration window. With it, the migration is enforced. Recommend: ship the lint before the second machine lands. |
| O4 | WCAG `role="alertdialog"` for recoverable-error panel (US-003) | LOW | Implementation-level; out of scope for DESIGN; DISTILL's acceptance test should assert focus management. |
| O5 | Whether the `scope_reconciled` event needs a UI surface (toast) in this feature, or is observability-only | LOW | DESIGN ships observability-only (ADR-029 §"Open Q3"). If user wants a UI surface, this is an additive future. |

---

## DEVOPS handoff annotations

For `platform-architect` (DEVOPS wave, on the path to deployment):

### External integrations requiring contract tests

- **Flow-State Tier → WorkOS** (OIDC `/v1/sso/token`, `/v1/users/{id}`)
  - Recommended: consumer-driven contracts via **Pact-JS** in CI acceptance stage.
  - Rationale: WorkOS is an external API the tier consumes; minor-version drift in WorkOS's response shape would cause production auth failures undetectable by unit tests.

- **Flow-State Tier → auth-proxy** (`POST /api/auth/reissue`)
  - Recommended: validate the tier's mock-server against `auth-proxy/lib/openapi.ts` in CI.
  - Rationale: internal contract; OpenAPI-based contract test is sufficient.

- **Flow-State Tier → Backend** (`POST /api/orgs`, `POST /api/auth/reissue` if backend-owned)
  - Recommended: validate the tier's mock-server against FastAPI's OpenAPI document in CI.
  - Rationale: same as above; both consumers and providers live in the repo, so OpenAPI is the single contract.

### Compose topology delta

The compose acceptance test stack grows from 5 services to 7 (per ADR-030 + ADR-031):
1. auth-proxy
2. agent
3. backend (api)
4. query-engine
5. MinIO
6. **flow-state** (NEW — per ADR-030)
7. **frontend-remix** (NEW — per ADR-031; runs alongside the existing `frontend` nginx container, strangler-fig per route)

Redis (already present) is unchanged but is now consumed by three logs (agent's thread-event, agent's presentation-state, flow-state's flow-event) with distinct key prefixes.

### Instrumentation list (inherited from DISCUSS `outcome-kpis.md`)

DISCUSS produced an 8-FE-event + 2-auth-proxy-event instrumentation list and 3 dashboards. DESIGN does not modify this list. Adds for the flow-state tier:

- `flow_event_appended` (per FlowEvent persisted to Redis)
- `projection_served` (per `GET /api/flows/{id}/projection`)
- `freeze_broadcast_started` / `freeze_broadcast_completed` (cross-machine FREEZE telemetry)
- `replay_buffer_flushed` / `replay_buffer_abandoned` (US-005 outcome split)
- `scope_reconciled` (ADR-029 invariant 5)
- `probe_passed` / `probe_failed` (per adapter on startup)

---

## Risks carried to DISTILL

| # | Risk | Mitigation |
|---|---|---|
| RD1 | Remix migration may surface chat-SSE incompatibilities not visible from DESIGN | DELIVER carpaccio slice 1 deliberately defers FE changes; slice 2 is the SSE-touching slice. If a regression surfaces, the team can choose Option B at slice 2 without re-architecting slice 1. |
| RD2 | XState v5 actor-tree API may be a learning curve | Mitigate by code-review-gating the first machine + orchestrator; subsequent machines copy the pattern. ADR-028 references the canonical v5 docs. |
| RD3 | The `eslint-plugin-dashboard-chat-flow-state` custom rule has not been written | Treat as a small DELIVER scaffolding task before slice 2 (see O3 above). |
| RD4 | `POST /api/auth/reissue` endpoint may not exist | Spike at slice 1 kickoff; if absent, write a small backend ADR (auth-proxy-owned endpoint vs backend-owned) and add the endpoint in slice 2. |
| RD5 | Cross-tier observability (correlation_id threading) requires the auth-proxy to forward `X-Correlation-Id` to the flow-state tier | This already works for backend + agent; the auth-proxy's forward rules need one line for `/flow-state/*`. DEVOPS scope. |

---

## Sign-off checklist

Pre-DISTILL gate (DESIGN owner):
- [x] Reuse Analysis table populated (`wave-decisions.md` §D3).
- [x] C4 L1+L2+L3 diagrams in Mermaid (`application-architecture.md` §1-3).
- [x] 2 surviving options with full trade-offs (`application-architecture.md` §4).
- [x] Recommendation with single sharpest argument (`application-architecture.md` §12).
- [x] 3 ADRs proposed (ADR-027/028/029).
- [x] `active_scope` contract specified end-to-end (ADR-029).
- [x] Cross-machine FREEZE specified (ADR-027 §5).
- [x] Earned-Trust probes specified (ADR-027 §6).
- [x] Architectural enforcement specified (ADR-027 §7, ADR-029 §6).
- [x] External-integration contract-test annotations (this doc §"DEVOPS handoff").
- [x] OSS-first validated (all additions MIT; no proprietary).
- [x] `brief.md` updated under `## Application Architecture`.

Pending (DISTILL or user):
- [ ] User ratifies Option D vs Option B.
- [ ] User ratifies ADRs (Proposed → Accepted).
- [ ] Peer review by solution-architect-reviewer (Atlas).
