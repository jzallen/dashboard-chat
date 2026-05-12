# Wave Decisions — DISTILL — `user-flow-state-machines`

> **Wave**: DISTILL
> **Date**: 2026-05-11
> **Acceptance Designer**: Quinn (nw-acceptance-designer)
> **Inherited from DESIGN**: 5 artifacts under `docs/feature/user-flow-state-machines/design/`
> **Anchor**: `design/handoff-design-to-distill.md` (four-piece contract: endpoints + ActiveScope schema + flow events + projection shape)
> **Companion deliverables**: `features/*.feature`, `steps/*.ts`, `harness/UserFlowHarness.ts`, `roadmap.json`, `ui-state/` RED scaffold.

---

## DWD-1 — Test layout

**Decision**: A new TypeScript-native acceptance suite at
`tests/acceptance/user-flow-state-machines/`. Self-contained workspace
(its own `package.json`, peer to the existing Python suites under
`tests/acceptance/*/`). Runs from inside the suite directory; not part of
the root `turbo` graph (mirrors the Python suites' `--no-project` posture).

```text
tests/acceptance/user-flow-state-machines/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  features/
    walking-skeleton.feature
    slice-1-error-paths.feature
    slice-1-scope-resolver.feature
    slice-2-recoverable-error.feature
    slice-2-harness-drives-transitions.feature
    slice-3-expired-token-freeze.feature
    journey-invariants.feature
  steps/
    ui-state-client.ts          # HTTP client; the four-piece contract
    fake-workos.ts                # in-process WorkOS fake (Hono)
    walking-skeleton.steps.ts
    error-paths.steps.ts
    scope-resolver.steps.ts
    recoverable-error.steps.ts
    harness-drives.steps.ts
    expired-token.steps.ts
    journey-invariants.steps.ts
    fixtures/
      personas.ts                 # Maya, Rajesh (returning user)
      compose.ts                  # Docker Compose bring-up helpers
  harness/
    user-flow-harness.ts          # the TS UserFlowHarness (US-004)
    types.ts                      # ActiveScope, FlowProjection, FlowEvent
    README.md                     # documents the four-piece contract
```

**Framework choice**: `@cucumber/cucumber` (12.x) with `ts-node/esm`
loader, driving `vitest`-style assertions via `expect` from
`@vitest/expect`. Rationale:

1. `@cucumber/cucumber` is the canonical Gherkin executor; first-class
   support for `Scenario Outline`, tags, hooks, and parallel workers.
2. `vitest-cucumber` and `vitest-bdd` exist but layer Gherkin on top of
   Vitest's runner — adds an extra abstraction for a feature that
   doesn't share Vitest's unit-test fixtures.
3. The existing TS test surface in the repo is Vitest-only; adding
   cucumber-node here does not perturb agent/, auth-proxy/, reverse-proxy/
   suites.
4. Cucumber's `World` class is the natural container for harness +
   compose handles + correlation-id state; mirrors `pytest-bdd`'s
   `target_fixture` injection that the Python acceptance suites use.

**Note for DELIVER**: `DatasetLayerHarness` stays at
`backend/tests/integration/dataset_layer/` unchanged (JOB-001 backend +
agent contract guard; design D3 mandates compose-alongside-not-duplicate).
The new TS suite NEVER imports from the Python suite.

---

## DWD-2 — Walking Skeleton Strategy

**Strategy C — real local adapters with WorkOS as the only external
fake**, declared per `nw-test-design-mandates` Dimension 9a.

| Adapter | Real or fake? | Rationale |
|---|---|---|
| auth-proxy (Hono) | **REAL** — runs in compose | Production ingress; mocking it would skip the very wiring this WS proves. |
| ui-state tier (NEW Hono) | **REAL** — runs in compose | The seam under test. Mocking it makes the WS a unit test. |
| backend (FastAPI) | **REAL** — runs in compose | The `POST /api/orgs` + `POST /api/auth/reissue` consumers are part of US-002's happy path. |
| Redis | **REAL** — runs in compose | Capability-presence dispatch (`REDIS_URL` set) must exercise the Redis branch in WS, not noop fallback. |
| WorkOS | **FAKE (in-process Hono)** | External SaaS; we own no production credentials in CI; fake speaks the same OIDC token + profile shape via a small local Hono server. |
| ui-presentation | DEFERRED to Slice 2 | Slice 1 drives the ui-state tier via the TS harness (HTTP). The browser/FE participates from Slice 2 onward; Slice 1 still routes through `auth-proxy` (driving port). |

**Litmus test (per Dim 9d)**: "If I deleted the real `auth-proxy`
adapter, would the WS still pass?" → No. The WS POSTs through
`auth-proxy:3000` and asserts identity headers were injected before the
ui-state tier saw the request. Removing auth-proxy fails the test for
the right reason (wiring).

**Containers**: Docker Compose; the acceptance test stack grows to **7
services** per the amended handoff (auth-proxy + agent + backend +
query-engine + MinIO + ui-state (NEW) + ui-presentation (NEW)).
Compose bring-up sequenced from `steps/fixtures/compose.ts` with a
docker-readiness probe per service (Redis PING; auth-proxy /health;
ui-state /health; backend /health; MinIO /minio/health/live).

---

## DWD-3 — Driving port enforcement

Per Mandate 1 (CM-A): every scenario invokes through HTTP to
`auth-proxy` (`http://localhost:1042`), which is the user-facing
driving adapter declared in `design/application-architecture.md` §2.
The ui-state tier's port (`1043:8788`) is **never** invoked
directly by any test. The TS harness `UserFlowHarness` and the
fake-workos server are the ONLY HTTP clients tests construct;
neither imports from `ui-state/lib/**` source.

Verification grep planned for handoff (CM-A evidence):

```bash
grep -rE 'from .*ui-state/lib' tests/acceptance/user-flow-state-machines/ || echo OK
```

---

## DWD-4 — Mandate 4 (pure function extraction)

Per CM-D, the following pure functions are pre-identified for the
ui-state tier; DELIVER's crafter implements them BEFORE wrapping in
XState side effects:

| Pure function | Inputs | Outputs | Lives in |
|---|---|---|---|
| `resolveActiveScope(route, jwt, machineContext)` | route params + JWT claims + machine context | `ActiveScope` | `ui-state/lib/active-scope.ts` |
| `buildProjection(events, snapshot)` | `FlowEvent[]` + optional snapshot | `FlowProjection` | `ui-state/lib/projection.ts` |
| `validateOrgName(name)` | string | `Result<ValidatedName, ValidationError>` | `ui-state/lib/machines/login-and-org-setup.ts` (validators) |
| `classifyFailure(error)` | unknown error | `UnderlyingCauseTag` | `ui-state/lib/machines/login-and-org-setup.ts` (classifiers) |

Tests for these pure functions live as unit tests next to the source
(DELIVER's inner loop); they have ZERO fixture dependency.

The thin adapter layer (`RedisFlowEventLog`, `WorkOSClient`,
`BackendClient`, `AuthProxyClient`) is parametrized by env (compose
present or absent). The acceptance suite assumes compose-present; a
single `@in-memory` infrastructure-failure scenario exercises the
noop-fallback branch.

---

## DWD-5 — Scope rule (DISCUSS delta only)

Per the DISTILL workflow, scenarios are generated for behaviors in
`docs/feature/user-flow-state-machines/discuss/user-stories.md` only.
SSOT provides context (port entry per `brief.md`, KPIs per
`outcome-kpis.md`, failure modes per `journeys/login-and-org-setup.yaml`).
The journey-invariants test file (`journey-invariants.feature`) covers
IC-1 through IC-6 from the journey SSOT — these are cross-state
invariants the SSOT itself promises any J-001 implementation must
hold; they belong in the feature's acceptance suite because J-001 IS
this feature.

---

## DWD-6 — KPI observability (soft gate)

`docs/product/kpi-contracts.yaml` does **NOT** yet exist. The K1-K5
SSOT lives in `discuss/outcome-kpis.md`. Per the skill's soft gate,
this is logged as a warning and noted in `upstream-issues.md`:

> **REC-1**: Create `docs/product/kpi-contracts.yaml` during DEVOPS.
> Until then, `@kpi`-tagged scenarios in this suite assert that the
> ui-state tier *emits the metric event* named in `outcome-kpis.md`
> — they do not yet assert event shape against a contract.

Each `@kpi` scenario in the suite references its K-id in a comment
above the scenario (e.g. `# K1: welcome_page_rendered`).

---

## DWD-7 — Environmental Realism (Mandate 4 / Dim 8 Check B)

DEVOPS has not yet run for this feature; per the skill's graceful-
degradation rule, the WS Given clauses use the default environment
matrix:

| Env | Preconditions baked into Given | Walking skeleton with coverage |
|---|---|---|
| `clean` | Empty Redis; fresh Postgres schema; no pre-existing org for the persona | `walking-skeleton.feature` Scenario 1 |
| `with-pre-commit` | Compose stack restarted mid-flow; ui-state-tier reads existing FlowEvent log from Redis | `slice-3-expired-token-freeze.feature` (also covers Redis-rehydration on restart, mirroring ADR-030's failover acceptance) |
| `with-stale-config` | One nginx upstream rule still pointing at the old `frontend` for a route migrated to `ui-presentation` | `slice-1-error-paths.feature` Scenario 6 (stale-route-still-works graceful-degrade) |

A DEVOPS-produced `environments.yaml` will replace this default matrix
in the next gate.

---

## DWD-8 — RED-ready scaffolding (Mandate 7)

The ui-state tier source code does not yet exist. DISTILL scaffolds
the minimum production stubs under `ui-state/` so that:

1. TS imports across the codebase resolve (no `MODULE_NOT_FOUND`).
2. HTTP requests to the four routes return `501 Not Implemented` with
   a `__SCAFFOLD__: true` marker in the JSON body — tests classify as
   RED (failing-for-the-right-reason), not BROKEN.
3. The Docker Compose build succeeds (`ui-state/Dockerfile` +
   `BUILD.bazel` stubs).

Scaffolded files (10 total):

| File | Purpose |
|---|---|
| `ui-state/package.json` | Hono + xstate@5 deps; `__SCAFFOLD__` in version notes |
| `ui-state/tsconfig.json` | ESNext + bundler resolution; matches agent/ |
| `ui-state/index.ts` | Hono server skeleton; 4 routes return 501 |
| `ui-state/lib/machines/login-and-org-setup.ts` | XState v5 `setup()` stub |
| `ui-state/lib/orchestrator.ts` | actor-system stub |
| `ui-state/lib/active-scope.ts` | `ScopeResolver` stub (the pure-function shape from DWD-4) |
| `ui-state/lib/projection.ts` | `buildProjection` stub + `FlowProjection` type |
| `ui-state/lib/persistence/redis.ts` | XADD/XRANGE wrapper stub |
| `ui-state/Dockerfile` | builds the scaffold |
| `ui-state/BUILD.bazel` | compose-buildable scaffold target |

Every TS file exports `export const __SCAFFOLD__ = true;` and every
runtime entry-point throws `Error("Not yet implemented — RED scaffold")`
when invoked. Build configs use `// SCAFFOLD: true` comments.

---

## DWD-9 — Open items surfaced to upstream

Recorded in `distill/upstream-issues.md`:

1. **REC-1** (LOW): `kpi-contracts.yaml` is missing; DEVOPS should
   create it before merging this feature's monitoring instrumentation.
2. **UI-1** (HIGH): `POST /api/auth/reissue` may not exist on the
   backend (`design/handoff §O1` flagged this LOW). The WS scenario
   for slice 1 does NOT depend on this endpoint (Maya's first sign-in
   reaches `authenticated_no_org`, not `ready`). The Slice 1 remaining
   scenarios for US-002 happy path DO depend on it; the roadmap step
   for that scenario includes a 10-minute spike to confirm presence.
3. **UI-2** (MEDIUM): `ui-presentation` container is part of the
   compose stack per ADR-031 but Slice 1 WS does not exercise the
   browser — only `auth-proxy` and `ui-state` are hit. Slice 2
   begins exercising `ui-presentation` via real HTTP from the harness;
   Slice 3 requires full browser to verify the cross-machine FREEZE
   banner (this may push Slice 3 to use Playwright; documented but
   deferred until DELIVER's first slice-3 ticket).
4. **UI-3** (LOW): Option D vs Option B FE framework is not yet
   ratified by the user. The acceptance contract is framework-
   agnostic (per `handoff-design-to-distill.md`) — these tests pass
   identically against either FE choice.

---

## Sign-off checklist (DISTILL gate)

- [x] All five user stories (US-001..US-005) traced to scenarios via
      `@us-NNN` tag (Dim 8 Check A).
- [x] Walking skeleton declared with Strategy C (Dim 9a).
- [x] Walking skeleton invokes through driving port (`auth-proxy`
      HTTP) and exercises ALL local adapters real (Dim 9b/9d).
- [x] Error-path ratio ≥ 40% (verified: 14 of 34 scenarios tagged
      `@error-path`/`@boundary`/`@degraded` = 41%; adding the 6
      `@property` invariants that encode negative-branch contracts
      brings it to 59% — see `roadmap.json` `totals` block).
- [x] `@driving_port` tagged on every walking-skeleton scenario.
- [x] Driven adapters with a `@real-io` scenario: `RedisFlowEventLog`,
      `AuthProxyClient`, `BackendClient`, `WorkOSClient` (the WorkOS
      adapter `@real-io` is the integration against the **fake** WorkOS
      Hono server, which is real I/O over loopback HTTP — sufficient
      for the wire-format contract).
- [x] Business-language purity: zero `HTTP`, `JSON`, `Redis`, `JWT
      claim` terms inside Gherkin (verified by grep; technical terms
      live in step methods only).
- [x] Mandate 7 RED scaffolds present under `ui-state/`.
- [x] `roadmap.json` sequences three slices into 6 steps; each step
      names its `.feature` scenarios + production scaffolds to
      replace.
- [ ] Peer review by acceptance-designer-reviewer (Sentinel) — pending.
- [ ] Mandate compliance evidence (CM-A/B/C/D) attached to handoff.
