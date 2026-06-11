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
