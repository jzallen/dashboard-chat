# CDO-S5 — DELIVER wave notes

CDO-S5 is the FINAL closure slice of client-driven-onboarding: the ui-state "zero egress"
mandate (ADR-049 §4 / ADR-050 §e.5, DR-8/AR-8). Step 05-01 covers the session-chat half —
report-driven realignment + egress retirement + the session-chat OUTCOME members on the
closed shared wire union.

## Step 05-01 — session-chat report-driven + wire outcome members

### What changed (production)
- **shared/ui-state-wire/wire-event.ts** — ADDED a `SessionChatWireEvent` union (the four
  OUTCOME members `session_list_loaded` / `session_resumed` / `session_created` /
  `dataset_context_switched` + their `*_failed` partners) plus a `SessionChatFailureCause`
  string-literal union, referenced via `| SessionChatWireEvent` inside `ChatAppWireEvent`.
  Payload field lists are the retired invoke OUTPUT types verbatim (INV-PCO display data).
- **ui-state/lib/machines/session-chat/** — the machine is now REPORT-DRIVEN: it invokes NO
  server-side actors. `loading_session_list` → `awaiting_session_list_report` (a no-invoke
  WAITING state); `resuming_session` / `creating_session` / `switching_dataset_context`
  removed — the surviving UI intents (session_clicked / first_message_sent / dataset picks /
  refresh_session_list) now SETTLE in their originating live state and transition on the
  matching client OUTCOME report. The four egress actor fns + `*Actor` factories
  (loadSessionListFn / resumeSessionFn / createSessionEagerlyFn / switchDatasetContextFn) and
  every `fetch` / `backendUrl` reference were DELETED from setup/actors.ts; `buildActors`
  now returns an empty actor map and `SessionChatMachineDeps` is an empty deps surface.
- **chat-app router ACL** — extended the closed `chatAppWireEventSchema` with Zod arms for the
  eight new outcome members (well-formedness only); `_wireEventSchemaPin` stays
  `z.ZodType<ChatAppWireEvent>` (closed).
- **chat-app projection / snapshot** — `SESSION_CHAT_STATE_MAP` gains
  `awaiting_session_list_report` and drops the four dead invoke states; the snapshot
  transient set for `session-chat` is now empty (every report-driven state settles instantly,
  so a snapshot taken in `awaiting_session_list_report` is safe to persist).

### Additive-wire reconciliation (the three legacy members stay)
`org_form_submitted` / `create_project_submitted` / `switching_project_intent` are KEPT in
BOTH the shared `ChatAppWireEvent` union and the router ACL. They are still consumed by
foreign suites/consumers out of this step's scope —
`tests/acceptance/project-and-chat-session-management`,
`tests/acceptance/user-flow-state-machines`, and `frontend/` — and converge harmlessly as
known-but-unhandled → 200 in the report-driven / phase-gated machine. Removing them is OUT of
scope for CDO-S5 and would break those suites. (`retry_clicked` was already retired in
S3/S4; the report-driven session-chat has no retry intent — recovery is a fresh client
report: a `session_list_loaded` report or `refresh_session_list` from `error_recoverable`.)

### ui-chat-is-catalog-driven note (no ui/ chat impact)
`ui/`'s chat surface drives its OWN catalog fetches (projects / lineage / sessions) and does
NOT route through the ui-state session-chat machine. The session-chat egress retired here is
therefore a ui-state-INTERNAL cleanup with zero ui/ chat impact — no `ui/` code path consumed
the deleted loadSessionList/resumeSession/createSessionEagerly/switchDatasetContext actors.

### Deviations from the declared files_to_modify (necessary by-design wiring)
The egress retirement changes session-chat's contract from invoke-driven to report-driven; the
parent ChatApp coordinator and the composition root had to be re-pointed for the reports to
reach the child and for the build to stay green. These files were NOT in the step's
`files_to_modify` but the deletion mandate could not be honored without them:
- **ui-state/index.ts** — `buildChatAppDeps` no longer wires the four (deleted) session-chat
  `*Actor` factories; `sessionChat: {}`.
- **chat-app/machine.ts** + **chat-app/setup/types.ts** — the parent now forwards the eight
  session-chat OUTCOME report members verbatim to the live child on `engaged.chat` (the
  reports must reach the report-driven machine), and the `ChatAppEvent` union names them.
- **chat-app integration / contract / snapshot / state-router tests** — these drove
  session-chat through its (now-deleted) invoke layer and relied on auto-advance. They were
  reworked to the report-driven contract: send the client OUTCOME report through the parent
  instead of expecting an invoke to fire. This is SANCTIONED rework — the egress they exercised
  is retired by design (zero-egress mandate), not a test weakened to dodge a failure. The two
  R3 self-heal tests that snapshotted MID-`resuming_session` are retired (that transient invoke
  no longer exists) and replaced with the new "report-driven session-chat always settles"
  invariant.

### Verification
`cd ui-state && npx vitest run` → 17 files, 187 tests, all green. `npx tsc --noEmit` clean for
ui-state and shared/ui-state-wire. The org-onboarding python acceptance suite (full rebuilt
compose stack) is the slice-level integration gate run later at step 05-06, not the crafter's
outer loop.

## Step 05-02 — ui-state zero-egress cleanup (dead egress actors deleted + Redis-only config)

### What changed (production)
- **onboarding/setup/actors.ts** — DELETED the dead egress resolver functions (`getWorkOSUserInfo`
  / `getUserOrg` / `loadVerifiedSession` WorkOS-userinfo + `GET /api/orgs/me`; `createOrgFn` /
  `getOrg` `POST /api/orgs`) plus the `loadSession`/`createOrg` `fromPromise` actors, the egress
  `Config` (workosUrl/backendUrl) interface, and the `LoadSessionInput`/`CreateOrgInput` egress
  fields. The machine was REPORT-DRIVEN since CDO-S1 (no `invoke`), so this was pure dead code.
  The `actors` bundle is now empty (`{}`); the inert `RequestClient`/`OnboardingDeps` type aliases
  remain (no live caller) so the begin-envelope shape stays nameable by the transport.
- **onboarding/setup/types.ts** — dropped `OnboardingParams.config`; `OnboardingInput.config`
  retyped to an inert opaque optional (nothing reads it); identity seed (`user`) preserved.
- **onboarding/machine.ts** — context factory no longer copies `config` into `params`.
- **project-context/setup/actors.ts** — DELETED `resolveInitialScopeFn/Actor`,
  `createProjectFn/Actor`, `switchProjectFn/Actor` (already not invoked — `buildActors()` returns
  `{}`). `ProjectContextMachineDeps` shrunk to the empty contract. I/O-contract TYPES retained.
- **project-context/index.ts** — pruned the deleted-factory exports (types retained).
- **config.ts** — Redis-only: DELETED `workosUrl` (FAKE_WORKOS_URL), `backendUrl` (BACKEND_URL),
  `devUserHeadersFixture`. The Zod env schema now has only the optional `redisUrl`, so the
  container boots WITHOUT BACKEND_URL/FAKE_WORKOS_URL set (unblocks step 05-06 compose env removal).
- **index.ts** — `buildChatAppDeps()` returns `{ projectContext: {}, sessionChat: {} }`; the
  backendUrl/headers locals + the retired `resolveInitialScopeActor`/`createProjectActor`/
  `switchProjectActor` imports are gone.

### Test rework (sanctioned)
- **test-config.ts** — `makeMockFetch` + the egress `makeTestConfig` retired with the actors;
  `makeTestConfig()` is now Redis-only.
- **chat-app integration / contract / snapshot / state-router tests** — dropped the mock-`fetch`
  `request_client` fixtures + the `config`/`deps` egress envelope + the `resolveInitialScope`/
  `createProject`/`switchProject` `fromPromise` fakes (project-context invokes nothing). The
  cascade is driven purely by client-reported outcome events. This retires the deleted-egress
  test doubles WITH the actors (by design, not to dodge a failure).

### Identity-seed path PRESERVED
`router.ts coldStart` still reads `X-User-Email` → `OnboardingInput.user` → onboarding
`context.user` (INV-PCO single writer). Untouched.

### 05-02 zero-egress proof

```
$ grep -rnE 'backendUrl|workosUrl|fetch\(' ui-state/lib ui-state/config.ts ui-state/index.ts \
    | grep -v node_modules | grep -v '\.test\.' | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)'
(no output — every remaining mention is a doc comment; ZERO live references)
```

The lone surviving mentions are doc-comment references describing the now-deleted egress
(acceptable per the AC: a doc-comment mention is fine; a live reference is not).

### Verification
`cd ui-state && npx vitest run` → 17 files, 187 tests, all green. `npx tsc --noEmit` clean for
ui-state/. eslint: 0 errors.
