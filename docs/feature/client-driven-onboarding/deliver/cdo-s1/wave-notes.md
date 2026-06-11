# CDO-S1 wave notes — step 01-01

Onboarding report-driven realignment + identity seed (slice CDO-S1, OOP / XState v5).

## What landed (01-01)

The ui-state onboarding machine moved from invoke-driven (server-side
`loadSession`/`createOrg` I/O) to **client-report-driven** transitions, per
ratified ADR-049 (client-reported outcome-event model) + ADR-050 (application
contracts §e/§f).

- `onboarding/machine.ts` — initial state `awaiting_org_report` (no invoke).
  `awaiting_org_report` on `org_found` → `ready`, on `org_not_found` →
  `needs_org`. `needs_org` on `org_created` → `ready`, on `org_found` → `ready`
  (convergence), on `__force_failure__` → `error_recoverable`. The
  `verifying`/`creating_org`/`session_rejected` states + the `loadSession` &
  `createOrg` invokes + the `org_form_submitted` handler retired.
- Identity (`context.user`) is **seeded once** from the cold-start input
  (`OnboardingInput.user`), threaded from the auth-proxy-verified `X-User-Email`
  header. No outcome event ever writes identity (INV-PCO — exactly one writer).
- The parent advance `login → engaged` is **reused verbatim**: the existing
  `isUserReady` onSnapshot guard (onboarding child value === `ready`) fires; only
  the *producer* of `ready` changed (a client report instead of an invoke onDone).

## Reconciliations worth recording

### Additive wire union (wire_union_additive_in_s1)

`shared/ui-state-wire/wire-event.ts` ADDED the happy members
`org_found`/`org_not_found`/`org_created` (payload `{org: OrgSnapshot}` /
`{}`) and the project members `scope_resolved`/`no_projects_found`/
`project_created` (payload `{project: ProjectSnapshot}`), with
`OrgSnapshot = {id; name}` / `ProjectSnapshot = {id; name}`. It **kept** the
`{type: string}` catch-all AND the legacy members
`org_form_submitted`/`create_project_submitted`/`switching_project_intent`/
`open_deep_link`/`session_begin`/`__force_failure__`. Removing the legacy
members would break out-of-scope `frontend/` + `ui/` + acceptance-harness
consumers; their closure is CDO-S3/S5. The onboarding ACL
(`router.ts onboardingEventSchema`) likewise ADDED the three org arms
(well-formedness only) and kept `org_form_submitted` + `__force_failure__`.

### Identity threading (chat-app)

`ChatAppContext` gained `user: {email; display_name; first_name}`, seeded from
`OnboardingInput.user` at cold-start and threaded into the onboarding child's
invoke `input:` mapper. `router.ts coldStart` reads `X-User-Email` →
`OnboardingInput.user` (email from header; `display_name`/`first_name` = null —
auth-proxy injects no such header). The crash-class machinery
(`active_child_id` / `child_event` forward / `user_rejected`) was **not** touched
(CDO-S3 owns it). The transport is ADR-046 BYTE-untouched: a posted
`org_created {payload:{org}}` reaches the onboarding child as
`{type:"org_created", org:{id,name}}` because the parent's
`forwardChildEventToActiveChild` spreads `payload` to the event top level.

### Projection + settle + zero states

- `derive-state-document.ts` — `ONBOARDING_STATE_MAP` keys realigned to
  `awaiting_org_report`/`needs_org`/`ready`/`error_recoverable`;
  `deriveOnboarding` no-child fallback → `awaiting_org_report`;
  `deriveProjectContext` no-child fallback → `awaiting_scope_report`.
  `deriveSessionChat` fallback unchanged (`verifying`). `derivePhase` unchanged.
- `state-document.ts` — `anonymousStateDocument` onboarding zero
  `verifying` → `awaiting_org_report`; projectContext zero
  `verifying` → `awaiting_scope_report`; sessionChat zero unchanged.
- `snapshot.ts` — onboarding transient set emptied (`new Set<string>()`): the
  client-reported onboarding has NO invoke states, so `awaiting_org_report`
  settles immediately and the `/state` POST returns the settled document in one
  round-trip.

## Sanctioned test rework (NOT an Iron-Rule violation)

The retiring invoke contract broke pre-existing ui-state vitest tests that
asserted the OLD model (`session_begin` cascading via `loadSession`,
`org_form_submitted` → `ready`, re-verify failure → `session_rejected`, anon doc
`verifying`). These were reworked to the client-reported model
(`onboarding/machine.test.ts`, `chat-app/integration.test.ts`,
`chat-app/state-router.integration.test.ts`,
`chat-app/projection/derive-state-document.test.ts` + `.contract.test.ts`,
`chat-app/snapshot.test.ts`). Genuinely-retired cases were removed with a
`CDO-S3` marker comment:

- onboarding `session_rejected` via re-verify (no server probe exists now);
- onboarding org-name validation (`org_form_submitted` handler removed — CDO-S3
  reintroduces submit + validation).

Full ui-state vitest suite: **17 files / 180 tests green**. `tsc --noEmit`
clean.

### Contract-test arm that could not stay fully byte-equivalent

`derive-state-document.contract.test.ts` needs_org arm: the production
project-context no-child fallback changed to `awaiting_scope_report`, but the
out-of-scope `buildProjection` log fold (`lib/domain/projection.ts`) still folds
an empty log to `verifying` and has no event yielding `awaiting_scope_report`.
Rather than touch out-of-scope production or weaken the contract, the
onboarding region (the region under test) was pinned byte-equivalent to its
`buildProjection` fold, and the two un-invoked regions pinned directly to their
new client-reported zero states. The chat-reaching arms retain full three-region
log-fold equivalence. Flag for CDO-S2 when project-context realigns.

## Intermediate state (expected, documented)

After `org_created` the parent advances `login → engaged` and project-context
enters its OLD machine's initial state, so in 01-01 the `projectContext` region
still settles `no_projects`, NOT `awaiting_scope_report`. The 3 onboarding-only
acceptance checkpoints
(`test_orgless_principal_routes_to_onboarding`,
`test_org_absent_from_db_routes_to_onboarding`,
`test_org_creation_persists_created_by`) are GREEN; the `walking_skeleton` +
`default_project` cdo_s1 tests stay RED until 01-02 realigns project-context.

---

# CDO-S1 wave notes — step 01-02

Project-context report-driven realignment — Phase D (slice CDO-S1, OOP / XState v5).

## What landed (01-02)

The ui-state project-context machine moved from invoke-driven
(`resolveInitialScope` / `createProject` server I/O) to **client-report-driven**
transitions, completing Phase D (the automatic default project) per ADR-049 §3 +
ADR-050 §f.

- `project-context/machine.ts` — initial state `awaiting_scope_report` (no
  invoke; renamed from `resolving_initial_scope`). `awaiting_scope_report` on
  `scope_resolved` → `project_selected` (assignResolvedScope), on
  `project_created` → `project_selected` (assignCreatedProject — Phase D), on
  `no_projects_found` → `no_projects`. `no_projects` on `project_created` →
  `project_selected` (Phase D from either state). The `resolveInitialScope` &
  `createProject` invokes + the `creating_project` state + the
  `create_project_clicked` / `create_project_submitted` handlers retired. The
  root `open_deep_link` re-enter target + `auth_ready` re-enter target +
  `scope_mismatch_terminal` / `error_recoverable` recovery targets all repoint to
  `awaiting_scope_report`. `switching_project` + `switchProject` invoke +
  `scope_mismatch_terminal` UNTOUCHED (CDO-S3 reworks the switch + deep-link
  discrimination).
- `setup/types.ts` — `ProjectContextEvent` gained
  `scope_resolved`/`project_created` (payload `{project:{id,name}}`) +
  `no_projects_found` (`{}`); dropped `create_project_clicked` /
  `create_project_submitted`. `ProjectContextState` drops
  `resolving_initial_scope` / `creating_project`, adds `awaiting_scope_report`.
- `setup/actions.ts` — `assignResolvedScope` / `assignCreatedProject` now read
  `event.project.{id,name}` (the report payload) instead of `event.output.*`
  (the retired invoke result). The unused
  `recordProjectValidationError` / `clearProjectValidationError` /
  `capturePendingProjectName` (create-form actions) removed.
- The parent advance `engaged.project_context → engaged.chat` is **reused
  verbatim**: the existing `isInitialProjectSelected` onSnapshot guard
  (project-context child value === `project_selected` &&
  `last_forwarded_project_id === null`) fires; only the *producer* of
  `project_selected` changed (a client report instead of an invoke onDone). The
  (f) triple (projectContext=project_selected, active_scope.project_id non-null,
  phase=chat) is atomic on the `project_created` POST's own response document.

## Reconciliations worth recording

### Transport BYTE-untouched

A posted `project_created {payload:{project}}` reaches the project-context child
as `{type:"project_created", project:{id,name}}` because the parent's
`forwardChildEventToActiveChild` spreads `payload` to the event top level —
identical to the org-report transport 01-01 relied on. No router/parent change.

### Optional retired deps (deps shape only)

`ProjectContextMachineDeps.resolveInitialScope` / `.createProject` became
**optional** (the machine no longer invokes them) so the production composition
root (`ui-state/index.ts`, OUT OF SCOPE) + the chat-app test harnesses may keep
passing them harmlessly until their wiring is pruned (CDO-S3). `buildActors` now
wires only `switchProject` (the one retained invoke). The
`resolveInitialScopeFn` / `createProjectFn` production factories + the
`isCrossTenant` / `isProjectNotFound` / `isNoProjects` guards are RETAINED
(unreferenced by the machine now) for the CDO-S3 deep-link `scope_mismatch`
rework; only `projectNameValid` (which referenced the removed
`create_project_submitted` event and could not compile) was dropped.

### Projection + settle + zero states

- `derive-state-document.ts` — `PROJECT_CONTEXT_STATE_MAP` keys realigned:
  added `awaiting_scope_report`, dropped `resolving_initial_scope` /
  `creating_project`, kept `switching_project`. (`deriveProjectContext`'s
  no-child fallback was already `awaiting_scope_report` from 01-01.)
- `snapshot.ts` — the project-context "transient/not-settled" set dropped
  `resolving_initial_scope` / `creating_project` so `awaiting_scope_report` /
  `no_projects` / `project_selected` settle immediately; only
  `switching_project` stays transient. This is what makes the (f) triple atomic
  on the POST response (settle no longer hangs waiting on a removed invoke).

### Sanctioned test reworks (chat-app integration)

The chat-app integration / contract / snapshot / state-router tests' `arriveAtChat`
helpers drove project-context to `project_selected` via the removed
`resolveInitialScope` auto-resolve. They now report the resolved scope THROUGH
THE PARENT (`child_event {type:"scope_resolved", payload:{project}}`) — the same
report-through-parent pattern 01-01 applied to `org_found`. Updated:
`integration.test.ts`, `derive-state-document.contract.test.ts`,
`snapshot.test.ts`, `state-router.integration.test.ts`. The state-router happy
cascade test now pins the intermediate `project_context` + `awaiting_scope_report`
pause before the `scope_resolved` POST completes the cascade to `chat`. The
project-context `machine.test.ts` B1-B5 invoke tests were replaced with
report-driven transition tests (SANCTIONED rework per ADR-049); the US-207
switch tests' ARRANGE moved to a `scope_resolved` report (the switch PATH +
assertions unchanged).

### Contract test reconciliation (carried forward, still honest)

The `derive-state-document.contract.test.ts` chat-reaching arms retain full
three-region `buildProjection` log-fold equivalence (the live project-context
reaches `project_selected`, which the log fold also yields from
`project_selected`). The needs_org arm's un-invoked project-context region stays
pinned directly to `awaiting_scope_report` (the out-of-scope `buildProjection`
fold still cannot model it — flagged for CDO-S2, unchanged from 01-01).

## Result

ALL 5 cdo_s1 acceptance checkpoints GREEN
(`test_default_project_is_created_automatically_and_completes`,
`test_orgless_principal_completes_org_and_default_project`, + the 3 onboarding
checkpoints from 01-01). Full ui-state vitest GREEN (177 tests; the net -3 vs
01-01's 180 is the B1-B5/B6-B7 invoke tests replaced by the leaner report-driven
set). The (f) triple is atomic on the `project_created` POST; the switch /
deep-link paths remain green.
