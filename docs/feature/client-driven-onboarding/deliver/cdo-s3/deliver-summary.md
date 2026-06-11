# CDO-S3 — DELIVER summary

**Slice:** CDO-S3 (failure-class robustness + crash-class elimination + closed-union closure).
**Feature:** client-driven-onboarding · **Branch:** `crew/lifeguard` · **Issue:** `dc-o0x` · **Date:** 2026-06-11.
**Layer:** `shared/ui-state-wire/` + `ui-state/` (NON-GOALS held: no auth-proxy / ui / frontend / backend changes — CDO-S4/S5).
**Commits (atomic, Conventional Commits, no attribution, `Step-ID` trailers):**
`1136bd33` (03-01) · `041738a1` (03-02) · `e9ac5520` (03-03) · `e0895732` (03-04).

## What shipped

The no-dead-ends + no-crash guarantees layered onto the CDO-S1 happy skeleton (ADR-049 §3/§4, ADR-050 §c/§e, domain-model §4–§6, Option 1 ratified):

1. **Onboarding failure split (03-01)** — `org_create_failed` report splits **re-edit** vs **retry**: cause `org_name_taken` / `org_name_invalid` REMAIN in `needs_org` with `org_validation_error` (inline, no dead end); cause `org_create_failed` → `error_recoverable`. `error_recoverable` is now **report-accepting** (`org_created`/`org_found` → `ready`), killing the `partial-setup` terminal. `UnderlyingCauseTag` drops `partial-setup`, adds the §c `org_create_failed`; new `OrgCreateFailureCause` enum.
2. **Project-context failure (03-02)** — `project_create_failed` → report-accepting `error_recoverable` (accepts `project_created`/`scope_resolved` → `project_selected`); the `retry_clicked` re-invoke retired (retry = client re-POSTs + re-reports — the Spec 7b probe-first convergence target). New `ProjectCreateFailureCause`.
3. **Closed wire union + state-document narrowing (03-03)** — removed the `{type:string}` catch-all (the union is genuinely closed); added `org_create_failed`/`project_create_failed`/`scope_mismatch`/`project_switched` + the 3 cause enums + the surviving session-chat UI intents; `ChatAppPhase` lost `'rejected'`; `ReducedContext` pruned `access_token`, `pending_project_name`, `most_recent_session_per_project`, `last_used_resolution_degraded` (AR-7); `derivePhase` dropped the `user_rejected→rejected` branch.
4. **Crash-class elimination + closed router ACL + report-only switch (03-04)** — the 2026-06-10 settled-child crash class is **unrepresentable**: deleted `active_child_id` + the root `child_event`/`user_intent` total forward + `user_rejected`/`isUserRejected`/`captureUserRejected`; added **phase-gated vocabulary routing** (`login.on`→onboarding, `engaged.on`→project-context, `engaged.chat.on`→session-chat — each `sendTo` a fixed invoke id alive by construction). Router ACL is a full closed-vocabulary `z.ZodType<ChatAppWireEvent>` validated on every POST (unknown → **400 in every phase**); `forwardToActor` sends the event RAW (`{type,...payload}`, no `child_event` envelope, no `switching_project_intent→PROJECT_SWITCH`). Project switch is now report-only (`project_switched`/`scope_mismatch`; the `switchProject` invoke + `switching_project` state + `isAccessRevoked`/`isSwitchProjectNotFound` guards retired).

KPI literals `ready` / `error_recoverable` preserved by name (auth-proxy sniffer). Session-chat machine UNCHANGED; its chat-phase vocabulary is still delivered as today.

## Verification

- **ui-state unit gate:** `npx vitest run` → **197 passed (17 files)** (177 baseline → +20 across the slice); `tsc --noEmit` clean; `shared/ui-state-wire` `tsc --noEmit` clean.
- **DWD-5 deterministic crash reproduction** (`chat-app/machine.test.ts`): an out-of-phase onboarding event posted while `engaged` → no transition, settled snapshot unchanged, **actor stays active**, and a subsequent in-phase event still advances the lifecycle (convergence + LIVENESS). Confirmed a genuine regression lock (would fail on the pre-03-04 total-forward).
- **Acceptance (real stack, `cdo_s3`):** **4/5 PASS** — `test_org_create_failure_retryable` (Spec 5), `test_default_project_retry_convergence` (Spec 7b), `test_late_event_converges_process_alive` (Spec 8 convergence + liveness), `test_unknown_event_type_rejected` (closed union → 400). The sibling re-edit arm `test_invalid_org_name_stays_needs_org` (org_name_invalid) is **GREEN**. The 1 RED, `test_org_name_taken_reedit`, is blocked by an **out-of-scope backend precondition** (see `upstream-issues.md` / below) — the same re-edit contract is otherwise green (invalid-name acceptance arm + the 03-01 unit test).
- **No regression:** `cdo_s1` walking skeleton + checkpoints **5/5 PASS**.
- **Adversarial review (Phase 4):** APPROVED, zero blockers (testing-theater scan clean; DWD-5 genuine; phase-gating + closed ACL + failure-split correct; no dead code/dual paths).
- **DES integrity:** all four 03-xx steps have complete PREPARE→COMMIT traces (`verify_deliver_integrity` exit 0).

## Known RED at handoff (documented, NOT this slice's defect)

- `test_org_name_taken_reedit` (`cdo_s3`): the backend returns **500** (not 409) on the second `POST /api/orgs` — `_ensure_user_has_no_org` raises `AuthorizationError`, which `@handle_returns` swallows into a `Failure` the org controller does not map → generic 500. In the single-principal `AUTH_MODE=dev` stack the test's "someone took it first" precondition is created **by the same dev principal**, so the second create hits "already has org" before any name-uniqueness 409 — a 409-name-conflict-by-another-user is unreproducible with one principal. Backend (CDO-S2 domain, merged) + DISTILL test-design issue; out of the shared+ui-state scope and the Iron Rule forbids editing the test. See `upstream-issues.md`.
- `test_mode_discovery`, `test_reissue_sets_cookie` (`cdo_s4`): expected RED — CDO-S4 not delivered.

## Single-cut consequence (ADR-050 §e, user-ratified "by user ruling")

Narrowing the SHARED types (the closed `ChatAppPhase`; the 4-field `ReducedContext` prune) narrows what out-of-scope packages import. Confirmed readers: `ui/app/routes/app-shell.tsx` (`phase === "rejected"`) — CDO-S5 owns ui/; `frontend/app/routes/projects.tsx` (the pruned J-002 fields) — parked legacy SPA. Removing the catch-all alone does NOT break them (they construct only kept named members). NOT fixed here; completed in CDO-S5's single-cut. The refinery `--auto` (backend pytest) gate + ui-state vitest/tsc + shared tsc are unaffected.

## Deviation with rationale (documented)

ADR-050 §e.2 asks the router ACL be "compile-bound to the shared union (`z.ZodType<ChatAppWireEvent>`)". `ui-state` has **no dependency/build linkage** to `@dashboard-chat/ui-state-wire` (it is not in `ui-state/node_modules` and not imported anywhere in `ui-state`; only `@dashboard-chat/shared-failure-simulation` is). So the router mirrors the closed union **locally** with a `z.ZodType<ChatAppWireEvent>` pin against the mirror — the same parallel-definition pattern ui-state already uses for `ChatAppStateDocument`. Cross-package consistency is maintained by convention + the real-stack acceptance suite, as it has been throughout ui-state.

## Carried forward

- **CDO-S4:** mode discovery (`GET /api/auth/config`), reissue `Set-Cookie`, retry-KPI cleanup.
- **CDO-S5:** ui/ onboarding-driver + login mode UI + app-shell `rejected`-branch removal; retire the legacy wire members (`org_form_submitted`/`create_project_submitted`/`switching_project_intent`) + the `switchProject`/`resolveInitialScope`/`createProject` optional-deps wiring in `ui-state/index.ts`; session-chat egress retirement + report vocabulary; frontend/ reconciliation of the pruned fields; the single-cut compose deploy.
- **Upstream:** the backend `AuthorizationError→500` org-create mapping + the DISTILL single-principal name-conflict reproducibility (`upstream-issues.md`).

See `wave-notes.md` for the per-step reconciliation log.
