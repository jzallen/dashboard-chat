# DISTILL Decisions — client-driven-onboarding

**Wave:** DISTILL (acceptance-test design)
**Date:** 2026-06-11
**Inputs (binding):** design-intent.md (user-ratified seed) + ADR-048/049/050 (Accepted 2026-06-11) + the DESIGN handoff (`design/handoff-design-to-distill.md`) + the application pass §e.4 per-file migration verdicts.
**Output SSOT:** the reworked `tests/acceptance/org-onboarding/` `.feature` (scenario SSOT) + test_*.py (per AR-6, rework in place) + `roadmap.json` (this dir).

---

## Prior-wave reading checklist

```
+ design/handoff-design-to-distill.md        + design/wave-decisions.md (incl. Ratification record 2026-06-11)
+ docs/decisions/adr-048 + adr-049 + adr-050  + design/domain-model.md (statecharts + Specs 1-8)
+ design/application-architecture.md (HTTP/wire contracts, §e.4 per-file verdicts)
+ design-intent.md (the fixed seed + Phases A-D + open points a-f)
+ docs/product/journeys/login-and-org-setup.yaml (J-001 — read; STALE, see UPSTREAM-1)
+ docs/product/architecture/brief.md (already amended for this feature — §Context map amended 2026-06-10 ADR-049)
+ docs/product/jobs.yaml (JOB-001/JOB-002 referenced by J-001)
- docs/product/kpi-contracts.yaml (NOT FOUND — soft gate; warn + proceed)
- docs/feature/client-driven-onboarding/discuss/ (NOT FOUND — brownfield: seed is design-intent, per CLAUDE.md routing)
- docs/feature/client-driven-onboarding/spike/ (NOT FOUND — no spike run)
- docs/feature/client-driven-onboarding/devops/ (NOT FOUND — graceful: the compose stack IS the environment; no infra constraints beyond it)
+ tests/acceptance/org-onboarding/* (driver, conftest, feature, all 7 test files, pyproject, README)
+ ui-state/lib/machines/chat-app/router.ts (ACL + forwardToActor — grounds the RED behaviour)
+ shared/ui-state-wire/wire-event.ts (the current open union being closed)
```

## Wave-decision reconciliation (pre-scenario gate)

**Result: PASSED — 0 blocking contradictions.** DISCUSS and DEVOPS artifacts are absent (graceful degradation: this is a brownfield feature whose user-ratified seed is `design-intent.md`, per CLAUDE.md's brownfield routing — DISCUSS is skipped; the DESIGN ADRs are the binding SSOT). The DESIGN passes are internally consistent and ratified. The only inter-artifact divergence is the J-001 journey YAML (still the superseded server-actor write model) — recorded as **UPSTREAM-1** (back-propagation, not a blocker; `brief.md` is already amended and the ADRs supersede ADR-041's write model explicitly).

## Driving port (port-to-port principle)

Every scenario's driving port is the **user-facing ingress (reverse-proxy)** — the authenticated principal drives the flow over HTTP: probing existence (`GET /api/orgs/me`), creating resources (`POST /api/orgs`, `POST /api/projects`), reporting outcomes (`POST /ui-state/state/events`), discovering mode (`GET /api/auth/config`), and reading state (`GET /ui-state/state`). No scenario enters from a ui-state internal or a machine API — TBU (Tested But Unwired) defects stay structurally impossible. The suite's `driver.py` plays the **client** (the ratified driving party): it performs the real backend writes AND narrates them.

---

## Decisions

### DWD-1 — Walking Skeleton strategy: C (real local), inherited

The shipped suite already uses Strategy C (real compose stack; `@real_io`; no in-memory doubles), `AUTH_MODE=dev` + `DEV_NO_ORG=true` primary. **Confirmed unchanged.** The client-driven model does not introduce costly externals on the dev path (WorkOS is exercised only in workos mode, which the auth-proxy unit + fake-WorkOS cover — not this suite). All scenarios tagged `@real_io`; the skeleton tagged `@walking_skeleton @real_io`. Skips (never fails) when the stack is unreachable.

### DWD-2 — Acceptance migration: rework in place (AR-6), plain pytest pattern kept

Per AR-6 the suite is **reworked in `tests/acceptance/org-onboarding/`** — NOT a new `client-driven-onboarding/` directory. The shipped pattern is plain pytest functions with the `.feature` file as the business-language scenario SSOT (NOT pytest-bdd step bindings); this is **preserved** (continuity; no gratuitous restructure). Per-file verdicts executed exactly per application-architecture.md §e.4(ii): driver EXTEND; 5 REWORK; 1 REWRITE (`test_invalid_org_name`); 1 SURVIVES (`test_post_orgs_no_longer_auto_creates_project`); feature file REWORK + new scenarios.

### DWD-3 — Mandate 7 (RED-ready scaffolding): N/A for this HTTP-driven suite

The step layer imports only `driver` + `pytest` — never the production TS/Python modules under change. There are therefore **no production-module scaffold stubs to create** (the usual Mandate-7 ImportError→BROKEN risk does not arise). RED-readiness is achieved by the **real stack returning pre-feature behaviour that fails the new-contract assertions**. Verified: `pytest --collect-only` collects all 14 tests with no ImportError/marker error (not BROKEN); against an unreachable stack all 14 skip cleanly. Each test documents *why* it is RED-for-the-right-reason. Production-module scaffolding is DELIVER's concern, per language, in the unit suites.

### DWD-4 — RED-for-the-right-reason map (against the current pre-feature stack)

The current router enforces the closed `onboardingEventSchema` (only `org_form_submitted` + `__force_failure__`) **while `phase==onboarding`**, and forwards verbatim afterwards (`router.ts:443`, `:560-573`). This pins the RED reasons:

| Scenario | RED because (new contract unimplemented) |
|---|---|
| walking skeleton, orgless-routes, org-absent, created_by, default-project | `session_begin` settles `verifying`→`needs_org` (old invoke), and `org_not_found`/`org_created`/`project_created` are unknown to the onboarding ACL → **HTTP 400**; the report-driven state-set (`awaiting_org_report`, report-settled `ready`/`project_selected`) does not exist. |
| invalid-name (rewrite) | backend `OrgCreate.name` is unconstrained → blank name returns **201, not 422**; `org_create_failed` is not a wire member. |
| name-taken (Spec 4) | the 409 is existing behaviour, but `org_create_failed{org_name_taken}` is not a wire member → the re-edit report cannot settle the region. |
| org-create-5xx-retry (Spec 5) | `org_create_failed` not a member; shipped `error_recoverable` has **no exit transitions** (terminal-in-practice). |
| project-retry-convergence (Spec 7b) | project-context is invoke-driven; `project_create_failed`/`scope_resolved` are not report triggers; region is not `awaiting_scope_report`. |
| late-event convergence + liveness (Spec 8) | reaching engaged needs the new vocabulary (RED at setup); convergence+liveness is the user-facing guarantee (crash vector limitation in DWD-5). |
| unknown-type 400 | reaching engaged needs the new vocabulary; even engaged, the old router **forwards** unknown types (200) rather than rejecting (400) — total closed-union enforcement is unimplemented. |
| mode-discovery | `GET /api/auth/config` does not exist → not `200 {mode:'dev'}`. |
| reissue Set-Cookie | the reissue seam emits `X-New-Access-Token` only — the `Set-Cookie: auth_token` (D8) is unimplemented. |

`test_post_orgs_no_longer_auto_creates_project` is a regression LOCK (already-shipped no-auto-create) — expected GREEN, guards against reintroduction (not a RED scenario).

### DWD-5 — Spec 8 crash regression: convergence + liveness at the port; the crash vector proper is a DELIVER unit test

The 2026-06-10 process death required the parent in `user_rejected` with `active_child_id` still naming the stopped onboarding child — reachable only via a WorkOS **re-verify failure**. In the dev acceptance stack the re-verify hits the fake-WorkOS (always 200) and `user_rejected` retires, so the crash vector is **not deterministically reproducible at the HTTP port**. The acceptance Spec-8 scenario therefore asserts the **user-facing guarantee**: a late/out-of-phase known event → no transition, current document returned (convergence) AND a subsequent request succeeds (liveness — the process did not die). The **deterministic crash reproduction** (send an event to a settled child; assert no unhandled throw / process survival) is a **ui-state unit/router test in CDO-S3** — recorded here so DELIVER does not lose it.

### DWD-6 — workos-mode coverage is out of this suite (auth-proxy unit + fake-WorkOS)

Per §e.4, the dev acceptance suite does NOT cover workos-mode interception (pre-check / provision / compensation / reissue-claim-correctness) — the dev stack runs `AUTH_MODE=dev`. Those land as **auth-proxy unit tests + a fake-WorkOS acceptance via the `WORKOS_BASE` pin (R4)** at DELIVER (CDO-S5). The python suite asserts the **dev-observable halves**: mode-discovery returns `dev`; the reissue **emits** `Set-Cookie: auth_token` (the hook is mode-agnostic per ADR-050 §a, so the emission is dev-observable — only the new org_id *claim correctness* is workos-specific). The `mode:'workos'` config response and the dev-button/no-dev-affordance rendering are auth-proxy-unit / ui-browser concerns.

### DWD-7 — ratification amendments encoded

1. **Plain past tense (DR-2 override):** every event uses `org_found`/`org_not_found`/`org_created`/`org_create_failed`/`scope_resolved`/`no_projects_found`/`scope_mismatch`/`project_created`/`project_create_failed`/`project_switched` + `session_begin`. No `*_reported` suffix anywhere. The retired UI-1 `create_project_submitted{payload.org_name}` misnomer is gone — Phase-D uses a real `POST /api/projects` + `project_created`.
2. **Cause tags machine-readable only:** scenarios that render a failure assert the document's re-edit signal (`org_validation_error`) or reach the report-accepting `error_recoverable` (the generic-surface state) — never a raw tag string. The "no raw tag in the rendered DOM" half is a browser/DELIVER assertion (this port-to-port suite asserts the document/state contract); noted in each failure test.
3. **Console-log audit trail:** asserting the `createLogger` narration is a browser-pass / DELIVER-unit concern (handoff: "may assert"); recorded as a CDO-S5 acceptance criterion, not a python-suite assertion.
4. **INV-PCO:** no test reads ui-state as a resource oracle — every resource claim is re-asserted against the backend (`GET /api/orgs/me`, `GET /api/projects`), exactly as the shipped suite did.
5. **No terminal dead-ends:** every failure scenario includes a tested retry path that reaches `ready`/`project_selected` (invalid-name, name-taken, org-create-5xx, project-convergence).

### DWD-8 — error-path coverage

14 scenarios; 7 happy/continuity + 7 error/edge/regression (`invalid-name`, `name-taken`, `org-create-5xx`, `project-convergence`, `late-event`, `unknown-type`, `no-auto-create`) = **50%** error/edge — above the ≥40% target.

### DWD-9 — DISTILL-time verifications pinned by the wave (AR-7 / AR-8)

- **AR-7 (no harness reads the four pruned `ReducedContext` fields):** `grep` across `tests/`. Within THIS suite: clean (the only `access_token` hits are the `/api/auth/callback` JWT-mint payload, unrelated to the pruned `ReducedContext.access_token` projection echo; the other three never appear). **BUT the SIBLING suite `tests/acceptance/project-and-chat-session-management/` DOES read three of them** (`most_recent_session_per_project`, `last_used_resolution_degraded`, `pending_project_name`) directly off `regions.projectContext.context` — see UPSTREAM-2 (HIGH). **The AR-7 gate therefore FAILS:** pruning these fields at DELIVER (CDO-S3) will turn that green sibling suite RED. Escalated, not silently proceeded.
- **AR-8 (session-chat UI-intent members enumerated mechanically):** out of scope for THIS suite (org/project onboarding); the session-chat vocabulary lands in CDO-S5 with its own coverage. Recorded for traceability; the mechanical enumeration is in application-architecture.md §e.5.

---

## Self-review checklist (Dimension 9 + Mandate 7)

- [x] WS strategy declared (DWD-1: C, inherited).
- [x] WS scenario tagged `@walking_skeleton @real_io`; all scenarios `@real_io`.
- [x] Driven-adapter real-I/O coverage: every backend/ui-state/auth-proxy surface the flow touches is exercised with real I/O through the ingress (no doubles) — the whole suite is `@real_io`. workos-mode externals are the documented exception (DWD-6).
- [x] Mandate 7: HTTP-driven suite → no production-module scaffolds needed (DWD-3); collection clean (not BROKEN); RED-for-the-right-reason documented per file.
- [x] Driving adapter: the user-facing ingress is exercised via real HTTP for every scenario (subprocess-equivalent: real httpx over the reverse-proxy) — not a service-function call.
- [x] Business language in the `.feature`; technical detail in the driver/steps.
- [x] Error-path coverage ≥ 40% (DWD-8: 50%).
- [x] No terminal dead-ends — every failure scenario has a tested retry path (DWD-7.5).
- [x] Iron Rule honoured: the shipped GREEN suite goes RED only where behaviour genuinely changes; no assertion weakened to pass.

## Review trail

| Reviewer | Verdict | Findings addressed |
|---|---|---|
| nw-acceptance-designer-reviewer | **APPROVED** (high confidence; 9.8/10; zero blockers) — 2026-06-11 | CM-A/B/C all PASS; ratification amendments 1/2/4/5 PASS, 3 correctly deferred to DELIVER; every RED scenario independently verified RED-for-the-right-reason against the current router fact; error-path coverage 50%; walking-skeleton boundary proven (Strategy C, no drift). The two HIGH findings (UPSTREAM-2 AR-7/J-002 collision; UPSTREAM-3 WorkOS uniqueness) were independently confirmed as DELIVER-gate, NOT DISTILL blockers — already recorded in upstream-issues.md. No remediation required; suite ready for DELIVER. |
