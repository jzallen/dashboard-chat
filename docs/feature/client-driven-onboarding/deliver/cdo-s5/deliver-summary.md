# CDO-S5 — DELIVER summary

**Slice:** CDO-S5 — ui/ client-drive surfaces + auth-proxy workos org-create interception (the FINAL closure slice)
**Layer:** ui/ + auth-proxy + shared/ui-state-wire + ui-state + compose (single-cut closed-union deploy)
**ADRs:** ADR-048 (auth-proxy owns the WorkOS write workflow; env deltas §4; observability §5; R5 timeouts), ADR-050 (§a reissue [S4], §b org-id carry, §c failure causes + the BINDING DISPLAY RULE, §d mode discovery, §e closed wire vocabulary + session-chat §e.5, §f engaged flip)
**Delivered:** 2026-06-11 · branch `crew/chauffeur` · issue `dc-fx1`
**Crafter:** nw-software-crafter (Outside-In TDD, DES-monitored) · **Review:** nw-software-crafter-reviewer (APPROVE-WITH-NITS, all 6 binding requirements PASS)

## What shipped (7 atomic commits)

| Step | Commit | Change |
|------|--------|--------|
| 05-01 | `e0bc98c8` | `feat(ui-state): report-driven session-chat machine + wire outcome members (CDO-S5)` |
| 05-02 | `e8fa2c55` | `refactor(ui-state): delete dead egress actors + Redis-only config — zero egress (CDO-S5)` |
| 05-03 | `d0163f54` | `feat(auth-proxy): workos org-create interception (pre-check/provision/forward/compensate) (CDO-S5)` |
| 05-04 | `20639a99` | `feat(ui): onboarding-driver flow policy + ApiError + fetchAuthConfig (CDO-S5)` |
| 05-05 | `aabaee25` | `feat(ui): client-drive onboarding surfaces + mode-discovery login + display rule (CDO-S5)` |
| 05-06 | `6d07ac39` | `chore(compose): single-cut env deltas — ui-state zero-egress + auth-proxy WORKOS_BASE (CDO-S5)` |
| 05-07 | `450f307d` | `refactor(ui): review-fix — audit-trail resulting-state + uniform failure org_name + self-heal coverage (CDO-S5)` |

(Per-step prose, deviations, and evidence are in `wave-notes.md`.)

### 05-01 — session-chat DR-8 (shared + ui-state)
The ui-state session-chat machine became REPORT-DRIVEN: the four egress actors (loadSessionList/resumeSession/createSessionEagerly/switchDatasetContext) were deleted; the machine transitions on the new past-tense outcome members (`session_list_loaded`/`session_resumed`/`session_created`/`dataset_context_switched` + their `*_failed` partners) added to the closed shared union. Region renames `loading_session_list→awaiting_session_list_report`; `resuming_session`/`creating_session`/`switching_dataset_context` retired. The router ACL gained Zod arms for the outcome members (closed `z.ZodType<ChatAppWireEvent>`).

### 05-02 — ui-state zero-egress (config Redis-only)
Deleted the already-dead onboarding (loadSession/createOrg) + project-context (resolveInitialScope/createProject/switchProject) egress actor functions; shrank `config.ts` to Redis-only (dropped workosUrl/backendUrl/devUserHeadersFixture); pruned `index.ts` egress wiring; dropped the unused `OnboardingInput.config`. **ui-state now has ZERO live network egress** (grep-clean proof in wave-notes §05-02). The X-User-Email identity-seed cold-start path is preserved.

### 05-03 — auth-proxy WorkOS org-create interception
NEW `lib/org-create-workflow.ts` (pure, fault-injection-testable): pre-check availability → provision WorkOS org+membership (5s timeouts, no auto-retry create, 1 retry membership) → forward with `X-Provisioned-Org-Id` → compensate (DELETE, 1 retry) on backend non-201. A 409 pre-check makes ZERO WorkOS calls (no orphan); compensation failure emits `workos.org_compensate.fail{orphan_id}` and still relays the backend status; WorkOS-egress failure synthesizes the documented 502. `x-provisioned-org-id` joins `IDENTITY_HEADERS` (strip-then-inject). Dev mode is a zero-overhead straight-through. WorkOS provisioning ops added to the existing injected-fetch `lib/user-auth/workos.ts` boundary.

### 05-04 — ui/ driver foundation
NEW `ui/app/lib/onboarding-driver.ts` (pure policy, collaborator-injected): Phase-B probe with the definitive-answers-only rule (200→org_found / 404→org_not_found / transport error→no report); status→cause mapping; automatic Phase-D default project; manual org retry + project probe-first convergence (re-probe before re-POST, lost-201→scope_resolved); initial-scope resolution ported from the retired resolveInitialScopeFn. CONSOLE-LOG AUDIT TRAIL via createLogger (amendment 3). `backendClient.ts` throws `ApiError {status, body}`; `bootstrap.ts` gained memoized + Zod-validated `fetchAuthConfig()`.

### 05-05 — ui/ surfaces (the BINDING DISPLAY RULE)
`login.tsx`: no sign-in affordance until `fetchAuthConfig` resolves; dev button only when `mode==='dev'`; plain "Sign in" for workos; both invoke the unchanged `login()`. `onboarding.tsx`: the org form drives the real POST then reports (in-flight UI local); **ProjectNameForm DELETED** (Phase D automatic); **the `Cause: {cause}` anti-pattern is GONE** — re-edit causes render friendly inline helper text, the retry class renders a generic "Something went wrong on our end" surface; NO raw cause tag reaches the DOM. `app-shell.tsx`: gate set `{needs_org, error_recoverable}`; the `rejected` branch died; waits on `awaiting_org_report`; fires the Phase-B probe. The (f) navigation effect (`project_selected → refreshOrgGlobal() → navigate("/")`) is byte-preserved.

### 05-06 — compose env deltas (single-cut)
`docker-compose.yml`: ui-state lost `FAKE_WORKOS_URL`/`AUTH_MODE`/`BACKEND_URL`/`extra_hosts`; auth-proxy gained `WORKOS_BASE: ${WORKOS_BASE:-https://api.workos.com}` (the R4 fake-WorkOS seam). api/api-full already clean; the agent's AUTH_MODE/WORKOS_CLIENT_ID left (ADR-048 R3); the api AUTH_MODE override pin already absent. No topology change.

### 05-07 — review-driven polish (APPROVE-WITH-NITS → resolved)
D4 (binding amendment-3 fidelity): the audit trail now logs the RESULTING region state from `report()`'s returned document, not the region name. D3: the generic `org_create_failed` payload carries `org_name` uniformly. D2: added the session-chat `error_recoverable` self-heal convergence tests. D1: added 400→org_name_invalid to the onboarding route `it.each`. D5: added the app-shell probe de-bounce test.

## Verification (all gates GREEN)

| Gate | Result |
|---|---|
| **DES integrity** (`verify_deliver_integrity`) | All 7 steps have complete DES traces (PREPARE→RED_ACCEPTANCE→RED_UNIT→GREEN→COMMIT) |
| **ui-state vitest** | 189 passed (17 files) |
| **auth-proxy vitest** (`SKIP_DOCKER_ACCEPTANCE=1`) | 276 passed / 5 skipped (the multi-replica docker suite — no `auth-proxy:bazel` image) |
| **ui vitest** | 250 passed (22 files) |
| **ui typecheck** (`tsc --noEmit`) | clean |
| **backend** | ruff clean; 744 unit/router tests passed (no backend file touched; the CDO-S2 `test_organizations_provisioned_id` + organization use cases stay green). The `tests/integration/dataset_layer` `pandera` ModuleNotFoundError is a pre-existing LOCAL-env optional-dep gap, excluded by the `--auto`/`--backend` selector (integration is opt-in) and resolved in the refinery env |
| **Adversarial review** | APPROVE-WITH-NITS — all 6 binding requirements PASS (DISPLAY RULE, audit trail, zero-egress, legacy members kept, interception correctness, driver policy); no BLOCKER/HIGH; no testing theater. 5 nits (D1-D5) all resolved in 05-07 |

### Acceptance integration gate (org-onboarding suite, rebuilt single-cut stack, auth-proxy ingress :1042)

**13 passed / 1 failed** — the single failure is the documented, carried-forward **UPSTREAM-S3-1 RED** (`test_org_name_taken_reedit.py`). The @walking_skeleton + every cdo_s1/cdo_s2/cdo_s3/cdo_s4 scenario PASS; ui-state booted with the env removed (Redis-only config, single clean startup). `cdo_s5` has no python scenario (the workos interception is auth-proxy-unit-covered — DWD-6).

## Carried-forward RED (out of CDO-S5 scope, Iron-Rule-protected)

**UPSTREAM-S3-1** (`test_org_name_taken_reedit.py::test_name_taken_stays_needs_org_then_recovers_with_a_new_name`, cdo_s3): the second `POST /api/orgs` returns **500 instead of 409** because the backend `create_organization` raises `AuthorizationError` (`_ensure_user_has_no_org`) BEFORE the name-uniqueness check, and the org controller has no `AuthorizationError→4xx` arm. Compounded by a DISTILL single-principal test-design limitation (a genuine name-conflict-by-another-user is unreproducible in the dev `DEV_NO_ORG` target without a second principal). BOTH causes are in **backend + DISTILL** — outside the CDO-S5 declared scope (ui/+auth-proxy+shared+ui-state; no backend file is touched in S5). It shipped RED+documented at the CDO-S4 gate and is carried forward identically. The Iron Rule forbids editing the test. **Suggested follow-up (a backend slice, NOT CDO-S5):** map `AuthorizationError→403` in the org controller result-mapper AND/OR run the name-uniqueness check before `_ensure_user_has_no_org` so a duplicate yields the documented 409, plus a second-principal acceptance affordance. See `cdo-s3/upstream-issues.md`.

## Mutation testing

SKIPPED for this slice — consistent with CDO-S1..S4 (no per-package TypeScript mutation harness is configured for ui-state/auth-proxy/ui; the established verification for this feature's slices is the unit-suite greens + the adversarial review + the acceptance integration gate). Feature-level mutation, if desired, is a whole-feature finalize concern.

## Reconciliations (design-vs-slice-scope, documented for the record)

1. **Wire union additive for session-chat.** CDO-S5 ADDS the SessionChatWireEvent outcome members but KEEPS `org_form_submitted`/`create_project_submitted`/`switching_project_intent` — they remain consumed by the live `project-and-chat-session-management` + `user-flow-state-machines` suites, by `frontend/`, and as router-ACL known-but-unhandled→200 convergence members (project-context has NO switching_project state). ui/ STOPS PRODUCING the org-form/create-project members (it drives POST+report). Their full retirement is a future cleanup once those suites migrate. The slice title "shared (closure complete)" refers to completing the session-chat OUTCOME vocabulary, not removing the project-switch intent.
2. **ui/ chat is catalog-driven.** ui/'s chat surface (Chat/ChatSessionList/metadataApiSource) drives its own backend fetches via the catalog and does NOT route session list/resume/create through ui-state's session-chat machine. Retiring ui-state's session-chat egress is therefore a ui-state-INTERNAL cleanup with no ui/ chat impact; no dead probe/report choreography was bolted onto the working catalog-driven chat (that would be gold-plating).
3. **No new python acceptance scenario.** The workos interception is auth-proxy-unit-covered (injected-fetch fault injection); the org-onboarding python suite is the integration regression gate.

## Scope boundary held

ui/ (NOT frontend/) + auth-proxy + shared/ui-state-wire + ui-state + docker-compose.yml only. NO backend file touched (the backend has been a frozen pure-resource store since CDO-S2). The single-cut closed-union deploy + env deltas landed coherently in one merge.
