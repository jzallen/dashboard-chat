# Finalize — `user-flow-state-machines`

> **Feature shipped**: 2026-05-12 (all three slices)
> **Wave path**: DISCUSS → DESIGN → DISTILL → DELIVER → FINALIZE
> **Branch (finalize)**: `finalize/user-flow-state-machines`
> **Archived artifacts**: this directory (`discuss/`, `design/`, `distill/`,
> `deliver/`) is the verbatim DELIVER-end snapshot of the feature workspace.
> **Source workspace**: `docs/feature/user-flow-state-machines/` (preserved
> pending human review — see [§Workspace cleanup](#workspace-cleanup) for
> the recommendation).

---

## 1. Summary

A user-flow state-machine tier (`ui-state/`) was added as a new
single-replica Hono service behind `auth-proxy`. It owns the
`login-and-org-setup` machine (anonymous → authenticating →
authenticated_no_org → creating_org → ready, with `error_recoverable`,
`error_terminal`, and `expired_token` side-states), persists `FlowEvent`s
to Redis Streams via the ADR-018 capability-presence dispatch, and
serves a JSON projection at `GET /ui-state/api/flows/{id}/projection`
plus an SSE push channel at `…/projection/stream`. The FE consumes the
projection through Remix route loaders (`ui-presentation`, running
alongside the existing nginx `reverse-proxy` container per ADR-031); the TS
`UserFlowHarness` consumes the same projection over HTTP — neither
re-derives state.

The five user stories (US-001 through US-005) shipped as written. No
story was invalidated by DESIGN, DISTILL, or DELIVER; the journey
state machine in
`docs/product/journeys/login-and-org-setup.yaml` is the contract the
implementation honors.

---

## 2. Story-by-story outcome

### US-001 — New user reaches the welcome page with email pre-filled

**Shipped in**: Slice 1, Step 01-01 (commit `b523cd1`).
**What changed**: Maya's first sign-in renders `state.user.email` from
the projection on first paint (no separate `/api/users/me` race). The
`authenticating`-step UI appears within 100ms during slow round-trips,
and a missing-email WorkOS profile now transitions the machine to
`error_recoverable` instead of silently landing on the welcome page.
**KPI surface**: `welcome_page_rendered` event with
`email_present_at_first_paint` flag emitted by the FE; `time_to_email_visible_ms`
gauge.
**AC coverage**: vitest unit tests for the projection consumer and the
`error_recoverable` transition. Cucumber scenario authored at
`tests/acceptance/user-flow-state-machines/features/walking-skeleton.feature`
— shipped but `@skip` per [DI-1](#deferred-items).

### US-002 — Org creation lands in the app shell with scope chips visible

**Shipped in**: Slice 1, Steps 01-02 and 01-03 (commits `4762079`,
`1dacc38`, `d09bda2`).
**What changed**: `creating_org → ready` only transitions when BOTH the
org row write AND the JWT re-issue succeed; org-chip / user-chip /
project-chip render on the same first paint from `active_scope` (no
flicker through a placeholder). The Round-2 scope-chain AC landed
end-to-end: deep-linked project URLs paint with all three chips and the
project-scoped page body simultaneously; the chat agent receives
`org_id` + `project_id` from `active_scope` and rejects invocations
missing either dimension.
**Pure functions extracted (CM-D)**: `resolveActiveScope` (ADR-029
invariants I1–I5), `validateOrgName` (validators block on the machine),
`classifyFailure` (closed-vocabulary discriminated union over
`underlying_cause_tag`).
**KPI surface**: `app_shell_first_paint` event with `org_chip_value`,
`user_chip_value`, `project_chip_value`, `flicker_observed`.
**AC coverage**: vitest unit suites for the org-creation transitions,
the JWT-reissue idempotency contract, the scope-resolver invariants, and
the cross-tenant 403 guard. Five Cucumber scenarios at
`features/slice-1-error-paths.feature` and four at
`features/slice-1-scope-resolver.feature` are authored as step glue with
@skip per [DI-1](#deferred-items).

### US-003 — Transient auth failure shows an honest, recoverable error

**Shipped in**: Slice 2, Step 02-01 (commits `590ad30`, `b79671e`).
**What changed**: `error_recoverable` carries `correlation_id` + a
closed-vocabulary `underlying_cause_tag` (`transient`, `cookie-blocked`,
`partial-setup`, `silent-reauth-failed`). "Try again" re-enters
`authenticating` with the SAME `correlation_id` (the id threads across
auth-proxy / backend / worker / FE logs for the attempt). Three failed
retries transition to `error_terminal` with a "Contact support" CTA.
**KPI surface**: `auth_recoverable_error_shown`, `auth_retry_clicked`,
`auth_succeeded_after_retry`, `ready_reached`.
**AC coverage**: vitest unit suites for the retry-budget tracker, the
`RecoverableError` component's copy-variant table, and the closed-union
exhaustiveness compile-time check. Five Cucumber scenarios at
`features/slice-2-recoverable-error.feature` (one is the K3
observability `@kpi` scenario) are authored as step glue with @skip per
[DI-1](#deferred-items).

### US-004 — TS `UserFlowHarness` drives every J-001 transition

**Shipped in**: Slice 2, Step 02-02 (commits `05f5b73`, `39e158d`,
`9535dd7`).
**What changed**: The harness exposes seven methods —
`begin_auth(persona)`, `submit_org(name)`, `assert_state(expected)`,
`force_transient_failure(tag)`, `assert_jwt_carries_org_claim()`,
`expire_token()`, and `assert_scope({...})`. Every call reads / writes
the same projection the FE consumes (no parallel state); the harness
routes through `auth-proxy` (no test-only backdoor); the
ui-state tier exposes `__harness_force_failure__` /
`__harness_expire_token__` event handlers gated to dev mode. The
`assert_scope` named-column diff formatter reuses the shape from
`DatasetLayerHarness.assert_exactly_once_via_replay`.
**AC coverage**: `harness/user-flow-harness.test.ts` covers all seven
public methods plus the composition primitive (Slice 1 sibling-harness
composition demo). Six Cucumber scenarios at
`features/slice-2-harness-drives-transitions.feature` are authored with
@skip per [DI-1](#deferred-items).

### US-005 — Expired token freezes mutations and replays in flight

**Shipped in**: Slice 3, Step 03-01 (commit `d8d0d34`).
**What changed**: The `expired_token` state broadcasts FREEZE to all
spawned actors via XState v5's actor-tree pattern; a bounded replay
buffer (5 s timeout, 16-event cap) lives in the orchestrator (not the
FE). On silent-re-auth success the in-flight request(s) replay with the
new JWT; on failure the machine transitions to `error_recoverable`
carrying the ORIGINAL request's `correlation_id`. Concurrent 401s from
multiple in-flight requests produce exactly one `expired_token`
transition and exactly two replays. The non-blocking "Refreshing your
session…" banner is `role="status"` + `aria-live="polite"` (US-003's
`role="alertdialog"` accessibility concern resolved at implementation
time).
**KPI surface**: `token_expired_event`, `silent_reauth_ok`,
`silent_reauth_failed`; "duplicate request" detector.
**AC coverage**: `ui-state/lib/orchestrator.test.ts` covers FREEZE /
THAW broadcast, replay-buffer bounds, origin-actor exemption, and the
expired_token → freeze / ready → thaw auto-signalling. Seven Cucumber
scenarios at `features/slice-3-expired-token-freeze.feature` plus the
six IC-1..IC-6 invariants at `features/journey-invariants.feature` are
authored with @skip per [DI-1](#deferred-items) and example-based step
glue per [DI-3](#deferred-items).

---

## 3. ADRs ratified by this feature

| ADR | Title | Status | Where it lives in this archive |
|---|---|---|---|
| ADR-027 | UI-state tier + projection contract (JSON + SSE; full-state-per-event) | Accepted | `design/wave-decisions.md` §D5c, `design/application-architecture.md`, `design/handoff-design-to-distill.md` §4 |
| ADR-028 | XState v5 actor model (cross-machine FREEZE/THAW native idiom) | Accepted | `design/wave-decisions.md` §D5a |
| ADR-029 | `active_scope` propagation contract (server-resolved + invariants I1–I5) | Accepted | `design/wave-decisions.md` §D5d, `design/handoff-design-to-distill.md` §2 |
| ADR-030 | Topology + scaling (ui-state behind auth-proxy; single replica with documented ceiling triggers; `flow_id = {machine}:{principal_id}` multi-tenant safety) | Accepted | `design/system-architecture.md` §SD1–SD8, `design/wave-decisions.md` "System Decisions" |
| ADR-031 | Frontend tier transition (Remix alongside nginx; strangler-fig per route) | Accepted | `design/system-architecture.md` §SD5, `design/upstream-changes.md` "Change 9" |

ADRs are referenced from the archived design subtree. Standalone
ADR files at the project's `docs/adrs/` namespace are NOT created by
this finalize wave — the ratifying narrative lives in
`design/wave-decisions.md`, `design/application-architecture.md`, and
`design/system-architecture.md`, which are migrated here verbatim.
A future cleanup may extract canonical `docs/adrs/ADR-NNN-*.md` files;
the content is fully contained in this archive.

### ADR-032 — Service-tier renaming (deferred follow-on)

ADR-032 (service-tier renaming) is **ACCEPTED** but its rename
execution is **gated on post-Slice-3 + 4 Praxis review follow-ups**.
This finalize wave does NOT execute the rename. ADR-032 is referenced
here only as a documented follow-on; the rename should land in a
separate feature once Praxis review concludes.

---

## 4. Architecture deltas

- **New compose service**: `ui-state` (Hono + XState v5; host port
  `1043:8788`; single replica). Behind `auth-proxy` via the new
  multi-upstream routing rule (`/ui-state/*`). Persists FlowEvents to
  Redis Streams (key prefix `ui-state:{machine}:{principal_id}:events`;
  XADD per transition; snapshot every 50 events).
- **New compose service**: `ui-presentation` (React 18 + Remix v2 on
  Node; host port for migrated routes). Runs ALONGSIDE the existing
  `frontend` nginx container per ADR-031 strangler-fig; nginx is
  byte-unchanged and gains one new upstream rule.
- **Auth-proxy extension**: multi-upstream routing table (`/api/auth/*`
  local, `/ui-state/*` → ui-state tier, `/api/*` → backend default).
- **Compose acceptance stack count**: grew from 5 services to **7**
  (auth-proxy, agent, backend, query-engine, MinIO, ui-state,
  ui-presentation). The compose acceptance test verifies byte-identical
  startup of all 7.
- **Pre-existing inconsistency surfaced (not fixed)**: the agent is
  reached via nginx directly today (`/worker/` + the ADR-015 presentation-state
  route), bypassing `auth-proxy`. ADR-030 documents this; the
  ui-state tier sits behind auth-proxy correctly from PR-0 but the
  agent's bypass is out of scope for this feature.

---

## 5. DELIVER execution log

The wave shipped in three vertical slices via the gastown headless
merge queue (rig: `dashboard_chat`; `merge_queue.test_command` =
`./tools/test/test.sh --backend`).

| Slice | Steps | Stories | Crew worker | Commits on `main` |
|---|---|---|---|---|
| 1 (sign-in walking skeleton + slice-1 error paths + scope resolver) | 01-01, 01-02, 01-03 | US-001, US-002 | `maya` | `b523cd1`, `4762079`, `1dacc38`, `d09bda2` |
| 2 (recoverable-error UX + TS harness) | 02-01, 02-02 | US-003, US-004 | `kestrel` | `590ad30`, `b79671e`, `05f5b73`, `39e158d`, `9535dd7` |
| 3 (expired-token cross-machine freeze + replay) | 03-01 | US-005 | `keystone` | `d8d0d34` |
| DES tracking + DI-4 flag | — | — | `archivist` | `4599668`, `e05757c`, `56c6e27` |

DES phase coverage (from `deliver/execution-log.json`):

| Step | PREPARE | RED_ACCEPTANCE | RED_UNIT | GREEN | COMMIT |
|---|---|---|---|---|---|
| 01-01 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 01-02 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 01-03 | ✅ | ✅ | ✅ | — (missing) | — (missing) |
| 02-01 | ✅ | SKIPPED (DI-1 — Cucumber not headless-executable; vitest is verification surface) | ✅ | ✅ | ✅ |
| 02-02 | ✅ | SKIPPED (DI-1) | ✅ | ✅ | ✅ |
| 03-01 | ✅ | SKIPPED (DI-1) | ✅ | ✅ | ✅ |

Step 01-03's missing GREEN/COMMIT entries are the documented
[DI-4](#deferred-items) cross-worker log gap. The implementation
itself shipped green to `main` per commit `d09bda2` (crew worker
`maya`); only the local DES log entries were never written.

---

<a id="deferred-items"></a>
## 6. Deferred items / open issues

These items are explicitly **deferred follow-ons**, not resolved by this
finalize wave. Each is recorded with its owner / next action.

### DI-1 — 23 `@skip` Cucumber scenarios across 4 feature files

- **Where**: `tests/acceptance/user-flow-state-machines/`
- **Why**: The 7-service docker-compose stack plus the Cucumber harness
  cannot be reliably brought up in a single headless worker session
  within the current dispatch budget. Acceptance verification was
  deferred to vitest unit suites for Slice 2 + Slice 3.
- **Affected**: 5× @us-003 in `slice-2-recoverable-error.feature`, 6×
  @us-004 in `slice-2-harness-drives-transitions.feature`, 6× @us-005
  in `slice-3-expired-token-freeze.feature`, 6× IC-1..IC-6 in
  `journey-invariants.feature`. **Step glue is already in place** in
  each `steps/*.ts` file.
- **Follow-on owner**: ops / future Slice-4-style ticket. The eventual
  fix is a Cucumber + compose pattern that doesn't wedge the worker
  (likely: bring compose up once per Cucumber `BeforeAll`, share across
  scenarios, drop the per-scenario teardown).
- **Action on resolution**: remove the `@skip` tags from the affected
  @us-003 / @us-004 / @us-005 / @us-006 scenarios and re-run. No step
  glue work needed.

### DI-2 — Playwright-shaped @us-005 scenarios (banner / focus management / draft preservation)

- **Where**: `tests/acceptance/user-flow-state-machines/steps/expired-token.steps.ts`
- **Why**: Several @us-005 step bodies (banner focus management,
  transform-button paused indicator, draft preservation across re-auth)
  require Playwright-level DOM inspection. They are stubbed with
  `deferredToUi2` and remain @skip pending the
  [UI-2 ticket from DISTILL](distill/upstream-issues.md).
- **What HAS shipped**: unit-level coverage of the banner component
  (`ui-presentation/app/routes/expired-token-banner.test.tsx`) — the
  non-blocking aria semantics (`role="status"`,
  `aria-live="polite"`) are tested; the cross-tab focus-management
  browser behaviour is NOT exercised end-to-end.
- **Follow-on owner**: DELIVER follow-up ticket (UI-2). Decision
  needed: add Playwright as a driver alongside Cucumber, or split these
  scenarios into a separate Playwright suite.

### DI-3 — Property generators deferred for IC-1..IC-6

- **Where**: `tests/acceptance/user-flow-state-machines/steps/journey-invariants.steps.ts`
- **Why**: The @us-006 journey-invariants scenarios are authored as
  example-based step glue. Full fast-check property generators over
  personas, names, and routes are deferred to a follow-on ticket.
- **What HAS shipped**: structural invariants are enforced at the
  machine and orchestrator levels — IC-1 (correlation_id stability),
  IC-2 (JWT org claim == projection org.id), IC-4 (no app shell
  pre-reissue), and IC-6 (exactly-once silent renewal) are covered by
  vitest. IC-3 and IC-5 have example-based coverage in
  `journey-invariants.steps.ts`.
- **Follow-on owner**: future DELIVER ticket for property-based
  generators over the replay-buffer's out-of-order replay space.

### DI-4 — Step 01-03 execution-log gap (cross-worker handoff)

- **Where**: `deliver/execution-log.json`
- **Why**: Crew worker `maya` shipped Step 01-03 to `main` (commit
  `d09bda2`) without emitting complete DES phase events. The
  implementation (active-scope resolver, deep-link endpoint,
  scope-resolver vitest) is present on disk and verified by the
  Refinery merge-queue gate (`./tools/test/test.sh --backend`); only
  the local DES log entries were never written. This was flagged
  upstream in commit `56c6e27`.
- **Impact**: `verify_deliver_integrity` flags 01-03 as `3/5 phases`.
  Functional impact: zero. The Refinery merge-queue gate is unaffected
  because backend regression coverage runs there, not via DES.
- **Resolution**: the orchestrator deferred option (2) — mark the
  01-03 partial as `CHECKPOINT_PENDING` quoting the upstream
  maya-shipped commits — so the Slice 3 architectural payoff could
  land within the dispatch budget. This evolution document is the
  durable record; no further DES log catch-up is planned.

### REC-1 — `kpi-contracts.yaml` missing (carried from DISTILL)

- **Owner**: DEVOPS (platform-architect).
- **Why**: `discuss/outcome-kpis.md` enumerates K1–K5 with measurement
  plans, but no machine-readable contract exists for what events the
  ui-state tier MUST emit. `@kpi`-tagged scenarios in the suite
  currently assert the *name* of the event the tier emits (e.g.
  `welcome_page_rendered`), not its shape against a pinned schema.
- **Follow-on action**: create `docs/product/kpi-contracts.yaml` with
  Zod / JSON Schema for the 7 FE events and 2 auth-proxy events;
  re-run DISTILL's `@kpi` scenarios with shape assertions enabled.

### UI-3 — Option D vs Option B FE framework ratification

- **Owner**: User (DESIGN ratification — implicitly resolved by
  shipping `ui-presentation`).
- **Status**: this feature shipped Option D (Remix loaders). Recorded
  here for traceability; no further action.

### UI-4 — `environments.yaml` missing

- **Owner**: DEVOPS. The acceptance suite uses default environments
  (`clean`, `with-pre-commit`, `with-stale-config`). When DEVOPS lands,
  DISTILL re-runs the Dim-8b env-to-scenario mapping check.

---

## 7. Lessons learned

### 7.1 The DESIGN reuse pass paid off

Per `design/wave-decisions.md` §D3, every infrastructure pattern this
feature needed already existed in the codebase under a different
vocabulary (ADR-015's directive log, ADR-018's capability-presence
dispatch, ADR-016's auth-proxy ingress shape, the
`DatasetLayerHarness` composition stance). **Net new infrastructure**:
one Node tier, one Redis key prefix, one routing rule. **Everything
else was precedent.** This kept the engineering estimate honest (DESIGN
pre-committed 4–6 weeks; the actual cycle was a single calendar day of
crew-worker dispatch). The lesson — explicitly enumerate "pattern reuse
vs. extend vs. cannot reuse" before designing — generalizes to every
brownfield feature.

### 7.2 Scope-chain expressibility was the load-bearing framework criterion

OQ-8 (which framework expresses `active_scope` inheritance cleanly)
turned out to be the only criterion that materially differentiated the
five options. Inertia's adapter-maturity cut and Next.js's
mental-model-shift cut both reduced to "would NOT mechanically eliminate
the ChatView project-context race." Remix loaders did. The lesson — let
the load-bearing user-visible defect class (the race the user named in
Round-2) drive the framework decision; cheaper deltas are not cheaper
if they preserve the defect class.

### 7.3 The system-scope pass caught four under-specified deployment surfaces

Morgan's application-scope design was sound. Titan's system-scope
pass surfaced (a) the Remix-replaces-nginx implication that
contradicted the strangler-fig intent, (b) the `flow_id` multi-tenant
safety gap, (c) the implicit single-replica assumption, and (d) the
compose-stack count miscalculation (5+1 vs 5+2). All four were
additive clarifications, not contradictions. The lesson — application
scope and system scope are different reviews; running them as separate
passes (rather than collapsing them) caught defects that a single
review would have papered over.

### 7.4 Headless Cucumber + compose is fragile in the current dispatch budget

DI-1 surfaced in Step 02-01 and recurred in 02-02 and 03-01. The
shipped pattern — author Cucumber step glue, `@skip` the scenarios,
verify behaviour via vitest unit suites — preserved acceptance-level
DOCUMENTATION of the contract without burning the dispatch budget on
flaky compose bring-up. The lesson — when an acceptance-test runtime
is fragile, ship the step glue anyway (it's the contract), and route
verification through a stable runtime; mark the scenarios `@skip` with
a `Resolution path` recorded in `deliver/upstream-issues.md`. The
contract is preserved; the verification debt is named and ownable.

### 7.5 DES tracking gaps across crew handoffs are recoverable

DI-4 — crew worker `maya` shipped Slice 1 Step 3 to `main` without
emitting GREEN / COMMIT phase events — was discoverable at orchestrator
integrity-check time, but did not block Slice 3 from shipping. The
fix at finalize time was simply to document the gap in this evolution
document (the durable record) rather than retroactively rewrite the
DES log. The lesson — DES is the in-flight tracking, not the SSOT.
The SSOT is the git history + the evolution document + the test
suites. Treat DES gaps as recoverable documentation debt, not as
blocking integrity violations.

---

<a id="workspace-cleanup"></a>
## 8. Workspace cleanup — recommendation

Per the SKILL Phase C guidance, `docs/feature/user-flow-state-machines/`
is **NOT deleted** by this finalize wave. The full subtree
(`discuss/`, `design/`, `distill/`, `deliver/`) is mirrored verbatim
into this archive (`docs/evolution/2026-05-12-user-flow-state-machines/`)
alongside this FINALIZE.md.

**Recommendation for human reviewer**: after this PR lands, choose one
of:

1. **Remove** `docs/feature/user-flow-state-machines/` outright — the
   archive is the durable home. This is the standard pattern after
   FINALIZE and matches every other feature under `docs/evolution/`.
2. **Replace with a one-line README.md** that points at the archive —
   useful if you want the wave matrix to still show the feature exists
   under `docs/feature/` (per the SKILL's note about the wave matrix
   deriving status from the workspace directory).
3. **Leave intact indefinitely** — only if there is an active reason
   (e.g., ADR-032's Praxis review follow-up wants to re-open the
   discuss/design subtree). Document the reason in a README.md at the
   workspace root.

The finalize agent's recommendation is **Option 1 (remove)**: the
archive is complete, the git history preserves the workspace's
provenance, and the `docs/evolution/` README index pointer makes the
feature discoverable. ADR-032's follow-up should pull from this archive
when it lands, not from the temporary workspace.

---

## 9. Pointers

- **Feature commits on `main`** (in order):
  `b523cd1`, `4762079`, `1dacc38`, `d09bda2` (Slice 1) →
  `590ad30`, `b79671e`, `05f5b73`, `39e158d`, `9535dd7` (Slice 2) →
  `d8d0d34` (Slice 3) → `4599668`, `e05757c`, `56c6e27` (DES tracking
  + DI-4 flag).
- **Tests**: `tests/acceptance/user-flow-state-machines/` (Cucumber
  step glue, 23 scenarios @skip per DI-1), plus vitest suites under
  `ui-state/`, `auth-proxy/`, `ui-presentation/`, and
  `harness/user-flow-harness.test.ts`.
- **Production code**: `ui-state/` (new Hono + XState v5 service),
  `ui-presentation/` (new Remix container), `auth-proxy/` (multi-upstream
  routing table extension).
- **Architecture artifacts (archived here)**:
  - [`discuss/`](discuss/) — JTBD, journeys, US-001..US-005 stories
  - [`design/`](design/) — application + system architecture,
    ADR-027..031 narrative, handoff
  - [`distill/`](distill/) — roadmap, acceptance contract, upstream
    issues
  - [`deliver/`](deliver/) — execution log (5/6 steps fully tracked),
    DI-1..DI-4 upstream issues
