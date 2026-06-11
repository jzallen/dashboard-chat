# CDO-S3 wave notes — per-step reconciliation log

Slice CDO-S3 (OOP / XState v5 + Hono). 4 sequential steps, each green in the
ui-state vitest+tsc unit gate; the `cdo_s3` HTTP acceptance suite is the
orchestrator's post-merge outer loop. Baseline at entry: 177 vitest tests
(CDO-S1) → CDO-S2 added no JS → 191 at the end of 03-03 → **197** at 03-04.

## 03-01 — onboarding failure arms (commit 1136bd33)

`onboarding/{machine,setup/{domain,types,guards}}.ts` + `machine.test.ts` +
`setup/domain.test.ts`. Added `OrgCreateFailureCause`
(`org_name_taken|org_name_invalid|org_create_failed`); `UnderlyingCauseTag`
dropped `partial-setup`, added `org_create_failed`; `isUnderlyingCauseTag`
follows. `needs_org.org_create_failed` is an ordered arm (taken→`recordOrgNameTaken`
/ invalid→`recordOrgValidationError`, both no-target; else→`error_recoverable`
+`tagCause`). `error_recoverable` made report-accepting (`org_created`/`org_found`
→`ready`; `org_create_failed` self-loop). The S1-dormant
`recordOrgNameTaken`/`recordOrgValidationError`/`tagCause` already read the event
fields → `setup/actions.ts` needed no edit; only registered the actions in the
machine setup map. A small `causeTagOf(cause)→UnderlyingCauseTag` total helper
keeps `tagCause` arms typed (the wire `cause` is the full union; only the generic
`org_create_failed` reaches a tag arm — re-edit causes are guard-intercepted).
182 vitest, tsc clean.

**Out-of-scope finding (flagged, NOT fixed):** `ui-state/lib/domain/projection.ts:306`
(the legacy `buildProjection` log-fold) defaults `underlying_cause_tag` to the
string `"partial-setup"`. The field is typed `string|null` (not
`UnderlyingCauseTag`), so dropping the tag does NOT break compilation — a latent
value inconsistency in the retiring legacy projection, not a live break. Left for
the legacy-fold retirement (post-S3).

## 03-02 — project-context failure arm (commit 041738a1)

`project-context/{machine,setup/{types,actions}}.ts` + `machine.test.ts`. Added
`ProjectCreateFailureCause`; `project_create_failed`→`error_recoverable` on
`awaiting_scope_report` + `no_projects`; `error_recoverable` report-accepting
(`project_created`/`scope_resolved`→`project_selected`, `project_create_failed`
self-loop). Retired the `retry_clicked` arm. Dropped the now-unreferenced
`clearErrorAndBumpRetries`. The `switchProject` invoke + `switching_project` state
+ its guards stayed LIVE this step (so US-207 switch tests stayed green) — retired
atomically in 03-04. Design names the assign `assignReportedProject`; reused the
existing `assignCreatedProject`/`assignResolvedScope` (same behaviour, current
names) per the no-scope-creep rule. 188 vitest, tsc clean.

## 03-03 — closed wire union + state-document narrowing (commit e9ac5520)

`shared/ui-state-wire/{wire-event,state-document}.ts` +
`chat-app/projection/derive-state-document.ts` (+ `.test.ts`/`.contract.test.ts`)
+ `router.ts` (dead-comment). Removed the `{type:string}` catch-all; added the 4
failure/outcome members + 3 cause enums (the wire is the SSOT — shared cannot
import ui-state) + the 8 surviving session-chat UI intents. Kept the legacy named
members for FE/ui compat. `ChatAppPhase` lost `'rejected'`; `ReducedContext`
pruned the 4 fields + their `initialReducedContext` entries; `derivePhase` dropped
the `user_rejected→rejected` branch.

**Scope decision:** `ui-state/lib/domain/projection.ts` keeps its OWN
`ReducedContext` copy (ui-state has no `@dashboard-chat/ui-state-wire` import), so
pruning the SHARED type does NOT break ui-state tsc — `projection.ts` was left
untouched (its pruned-field writers retire with the legacy fold). 191 vitest,
ui-state tsc + shared tsc clean.

**Single-cut consequence (documented, NOT fixed):** the type-narrowing breaks
out-of-scope readers — `ui/app/routes/app-shell.tsx` (`phase==="rejected"`,
CDO-S5) and `frontend/app/routes/projects.tsx` (pruned J-002 fields, parked SPA).
ADR-050 §e cost, user-ratified "by user ruling"; completed in CDO-S5.

## 03-04 — crash-class elimination + closed router ACL + report-only switch (commit e0895732)

`chat-app/{machine,setup/{types,actions,guards},router}.ts` +
`project-context/{machine,setup/{types,actions,guards,actors}}.ts` + 5 test files.
(A run crashed on a socket error at RED_UNIT — the written tests were intact on
disk; resumed RED_UNIT→GREEN→COMMIT without re-doing.)

- **Parent:** deleted `active_child_id` + the `mark*Active` entries + the root
  `on:{user_intent,child_event}` total forward + `user_rejected` state +
  `isUserRejected` onSnapshot arm + `captureUserRejected` + the engaged
  `PROJECT_SWITCH` handler + `forwardSwitchToProjectContext` + the active-child
  forwarders. Added phase-gated handlers (`login`→onboarding, `engaged`→
  project-context [on `engaged`, not `engaged.project_context`, so switch reaches
  it from chat], `engaged.chat`→session-chat), each `forwardTo*` = `sendTo` a
  fixed live invoke id. `ChatAppEvent` union replaced with the spread vocabulary;
  `OnboardingResult.state` dropped `"session_rejected"`; `ChatAppLifecycle`
  dropped `"user_rejected"`. The `onSnapshot` hand-offs + the three invokes are
  verbatim.
- **Router:** closed `chatAppWireEventSchema` (discriminatedUnion, pinned
  `z.ZodType<ChatAppWireEvent>`) validated on EVERY POST → unknown 400 in every
  phase; the onboarding-phase-only dispatch retired. `forwardToActor` → raw
  `actor.send({type,...payload})`; no `child_event` envelope, no
  `switching_project_intent→PROJECT_SWITCH`. `__force_failure__` gate +
  `session_begin` cold-start preserved. The closed union is **mirrored locally**
  (ui-state has no shared-package dependency — see deliver-summary "Deviation").
- **Project-context report-only switch:** retired `switching_project` state +
  `switchProject` invoke + `isAccessRevoked`/`isSwitchProjectNotFound` +
  `captureSwitchTarget`/`assignSwitchedProject` + `switchProject` in `buildActors`
  + `switching_project_intent`. Added `scope_mismatch`→`scope_mismatch_terminal`
  and `project_switched`→`project_selected` (re-assign via `assignResolvedScope`,
  so the parent `shouldSwitchProject` onSnapshot still re-forwards `project_ready`).
  `ScopeMismatchCause` added.
- **DWD-5** (`chat-app/machine.test.ts`): the deterministic crash reproduction —
  out-of-phase onboarding event while engaged → no transition, settled snapshot
  unchanged, actor `status==="active"`, and a subsequent in-phase event still
  advances. The regression lock for the 2026-06-10 process death.

Sanctioned reworks (contract-change, not weakening — adversarial-review-confirmed):
`integration.test.ts`, `state-router.integration.test.ts`, `snapshot.test.ts`,
`derive-state-document.contract.test.ts`, `project-context/machine.test.ts` —
`child_event`/`user_intent`/`PROJECT_SWITCH`/`user_rejected`/`switching_project_intent`
drivers re-expressed as raw phase-gated events / report-only `project_switched`.
197 vitest, ui-state tsc + shared tsc clean. `switchProject` stays EXPORTED (uninvoked)
from `project-context/index.ts` + `ui-state/index.ts` for composition-root
compatibility — its wiring retires in CDO-S5.

## Acceptance (real stack, lifeguard compose project)

Recipe: `docker compose -f docker-compose.yml -f docker-compose.override.yml -f
docker-compose.dev-no-org.yml up -d --build auth-proxy ui-state api redis
query-engine`; hit the **backend/data root-perms trap** (api sqlite "unable to
open database file" → /api/orgs/me 401) → `docker run --rm -v "$PWD/backend/data:/data"
busybox chmod -R 777 /data` + recreate api; suite via auth-proxy:1042
(`REVERSE_PROXY_URL=AUTH_PROXY_URL=http://localhost:1042`, `uv run --no-project
--with httpx --with pytest --with pytest-asyncio pytest -m cdo_s3`).
Result: cdo_s3 4/5 (1 backend-blocked, see upstream-issues), cdo_s1 5/5
(no regression). Stack torn down; images left; app.db cleaned.
