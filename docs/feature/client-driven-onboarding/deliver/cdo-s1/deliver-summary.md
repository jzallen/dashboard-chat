# CDO-S1 — DELIVER summary

**Slice:** CDO-S1 (walking skeleton: closed-union happy vocabulary + ui-state
report-driven realignment, dev happy path end to end).
**Branch:** crew/framer · **Issue:** dc-8nh · **Date:** 2026-06-11.
**Commits:** `e5b1221` (01-01 onboarding realignment + identity seed),
`2aca9f6b` (01-02 project-context realignment — Phase D).

## What shipped

ui-state's onboarding + project-context XState machines moved from invoke-driven
server I/O to **client-reported outcome events** (ADR-049/ADR-050 §e/§f):

- Onboarding: initial `awaiting_org_report` (no invoke); `org_found`→`ready`,
  `org_not_found`→`needs_org`, `org_created`→`ready` (+ `org_found` convergence).
  Identity seeded ONCE from the verified `X-User-Email` header at cold-start
  (INV-PCO — no event writes identity).
- Project-context: initial `awaiting_scope_report` (no invoke); `project_created`
  (Phase D) / `scope_resolved`→`project_selected`, `no_projects_found`→`no_projects`.
- The parent advances (`login→engaged`, `engaged.project_context→chat`) are
  **reused verbatim** — only the producer of the child state changed (a client
  report instead of an invoke onDone). The (f) triple
  (projectContext=`project_selected`, `active_scope.project_id` set, `phase=chat`)
  is atomic on the `project_created` POST's own response document.
- `shared/ui-state-wire` gained the happy outcome members + `OrgSnapshot`/
  `ProjectSnapshot`; the closed-union catch-all + legacy members were **kept**
  (closure is CDO-S3/S5 — see wave-notes).

Files: `shared/ui-state-wire/{wire-event,state-document}.ts`,
`ui-state/lib/machines/onboarding/**`, `ui-state/lib/machines/project-context/**`,
`ui-state/lib/machines/chat-app/{machine,setup/types,router,projection/derive-state-document,snapshot}.ts`.
No changes to backend/, frontend/, ui/, auth-proxy/ (out of S1 scope).

## Demo evidence — 2026-06-11 (the HTTP acceptance suite is the demo)

Stack: compose project `framer` (auth-proxy:1042 ingress, ui-state, api, redis,
query-engine; AUTH_MODE=dev + DEV_NO_ORG=true). Suite:
`tests/acceptance/org-onboarding` (real HTTP through the ingress; the driver plays
the client — real backend writes + outcome reports).

```
7 passed, 7 failed
PASSED test_walking_skeleton_org_then_default_project   (the @walking_skeleton gate)
PASSED test_orgless_principal_routes_to_onboarding
PASSED test_org_absent_from_db_routes_to_onboarding
PASSED test_org_creation_persists_created_by
PASSED test_default_project_completes_onboarding
PASSED test_late_event_converges_process_alive          (bonus: convergence + liveness)
PASSED test_post_orgs_no_longer_auto_creates_project    (bonus: regression lock)
```

All 5 CDO-S1 driving tests GREEN, including the walking skeleton (orgless principal
→ probe+report → org → automatic default project → app entry on the (f) triple).
Full ui-state vitest: **177 passed (17 files)**, `tsc --noEmit` clean.

### Expected RED (out of S1 scope — NOT weakened)

The 7 failures are exactly the documented later-slice contracts:

| Test | Slice | Why RED |
|---|---|---|
| test_invalid_org_name_stays_needs_org | CDO-S2 | backend OrgCreate 422 validation not yet added |
| test_post_orgs_no_longer_auto_creates_project | (passes — already-shipped lock) | — |
| test_mode_discovery | CDO-S4 | GET /api/auth/config not yet added |
| test_reissue_sets_cookie | CDO-S4 | Set-Cookie reissue not yet added |
| test_org_name_taken_reedit | CDO-S3 | org_create_failed re-edit arm |
| test_org_create_failure_retryable | CDO-S3 | error_recoverable report-accepting |
| test_default_project_retry_convergence | CDO-S3 | probe-first convergence |
| test_unknown_event_type_rejected | CDO-S3 | closed-union unknown→400 (catch-all kept in S1) |

`test_unknown_event_type_rejected` returning 200 (not 400) is the direct, intended
consequence of the S1 additive-wire decision (catch-all retained); the closed-union
single-cut lands in CDO-S3/S5 per ADR-050 §e.

## Quality gates

- DES integrity: **"All 2 steps have complete DES traces"** (5/5 phases each,
  EXECUTED/PASS) — `verify_deliver_integrity` exit 0.
- Adversarial review (Phase 4, Testing-Theater 7-pattern scan + correctness):
  **APPROVED, zero defects** — INV-PCO single-writer upheld; active_scope correct;
  transient/settle set correct; ACL closed; wiring complete; no test weakening
  (the ~45-test rework is contract-change-driven; no `.skip`/`.only`/`xit`
  introduced; reductions track retired invoke cases 1:1).
- L1-L4 refactor folded into the crafter's per-GREEN RPP; review found no dead
  code or refactor-worthy issues, so no separate churn pass on green code.
- Mutation testing (per-feature strategy): **deferred to feature finalization**
  after CDO-S5 — running it on 1 of 5 slices is not yet meaningful; the
  acceptance + unit + adversarial layers cover this slice.

## Carried forward (for later slices)

- **CDO-S2:** `derive-state-document.contract.test.ts` needs_org arm — the
  out-of-scope legacy `buildProjection` fold (`lib/domain/projection.ts`) can't yet
  model `awaiting_scope_report`; the un-invoked region is pinned directly (honest,
  not weakened). Reconcile when project-context realigns server-side / the legacy
  fold retires.
- **CDO-S3:** close the wire union (remove catch-all + legacy members, add failure
  members), the crash-class elimination (active_child_id / child_event total
  forward / user_rejected), error_recoverable report-accepting, probe-first
  convergence, unknown-type→400.
- **CDO-S5:** retire the optional `resolveInitialScope`/`createProject` deps wiring
  in `ui-state/index.ts`; ui/ onboarding-driver + login mode UI.

See `wave-notes.md` for the full per-step reconciliation log.
