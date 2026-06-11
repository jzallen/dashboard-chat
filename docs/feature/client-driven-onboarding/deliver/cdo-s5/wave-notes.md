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

## Step 05-03 — auth-proxy WorkOS org-create interception (request side)

This is the production WorkOS write path that completes client-driven-onboarding: the
REQUEST-side half of the org-create seam (the RESPONSE side already shipped as CDO-S4's
`applyOrgCreateReissue`). ADR-048 §1/§3/§5 + ADR-050 §b/§c, layer = auth-proxy.

### What changed (production)
- **lib/user-auth/workos.ts** — ADDED three org-provisioning ops on the existing
  injected-fetch boundary (`this.fetchPort`, `config.baseUrl=WORKOS_BASE`,
  `config.clientSecret=WORKOS_API_KEY`): `createOrganization(name)→{id}`,
  `createOrganizationMembership(userId, orgId)`, `deleteOrganization(orgId)`. A shared
  `callWorkos` wrapper mirrors `callAuthenticate`'s failure mapping (throw/non-ok →
  `service_error`) but targets the API-key-authorized `/organizations` surface with
  `Authorization: Bearer <WORKOS_API_KEY>` and `AbortSignal.timeout(5000)` per call. NO
  auto-retry lives in this module — the WORKFLOW owns retry policy (R5).
- **lib/org-create-workflow.ts** — NEW. `runOrgCreateInterception({ name, userId,
  identityHeaders, correlationId, deps })` — the pure POLICY SSOT, free of Hono internals
  (every collaborator injected → the whole pre-check/provision/forward/compensate matrix is
  fault-injection-testable without standing up the proxy). Sequence:
  1. PRE-CHECK availability via the backend; a 409 mirrors the backend's JSON:API 409 and
     makes ZERO WorkOS calls (no orphaned IdP org).
  2. PROVISION org (no auto-retry — not idempotent) then membership (1 retry — idempotent).
     A membership failure after the retry → best-effort compensation delete, then a
     synthesized 502 `org_provisioning_failed`.
  3. FORWARD to the backend carrying `X-Provisioned-Org-Id`; relay the backend status
     verbatim.
  4. COMPENSATE: a non-201 persist after WorkOS success → best-effort `deleteOrganization`
     (1 retry). On compensation failure → emit the alertable `workos.org_compensate.fail`
     carrying the orphan id, and STILL relay the backend status (compensated/uncompensated
     is client-indistinguishable, ADR-050 §c).
  Emits `org_create.intercepted` (ADR-048 §5) on every interception via the injected `emit`.
- **lib/auth.ts** — `x-provisioned-org-id` joins `IDENTITY_HEADERS` so a client-supplied
  value is STRIPPED on EVERY route (strip-then-inject); only the interception re-injects the
  proxy's own provisioned id on the backend forward. The backend already trusts this channel
  (TRUST_PROXY_HEADERS; ADR-050 §b — the WorkOS org id IS the local org id).
- **app.ts** — the catch-all `app.all('*')` gains a CHEAP path+method+mode guard between the
  identity-header inject and `proxyRequest`: `POST /api/orgs` in `AUTH_MODE=workos` →
  `interceptWorkosOrgCreate` wires the closures (availability pre-check + WorkOS provisioner
  from `createWorkosProvisioner` + a backend-forward that injects `X-Provisioned-Org-Id`) and
  delegates to `runOrgCreateInterception`. The post-response `applyOrgCreateReissue` STILL
  fires on the relayed 201. Dev mode and every other route/method fall through unchanged
  (zero overhead).

### Compensation is best-effort by design (UPSTREAM-3 RESOLVED)
WorkOS does NOT enforce org-name uniqueness, so compensation stays best-effort per
ADR-048 A+B: an uncompensated orphan does not block a later retry of the same name. The
`workos.org_compensate.fail` event is the out-of-band reconciliation hook for orphans the
best-effort delete (1 retry) could not clean up.

### Body-streaming note
The inbound `name` is read from `c.req.raw.clone().text()` and the SAME buffered bytes are
re-emitted on the backend forward. In this undici version a clone-then-stream locks the
original body that the forward would otherwise pass through, so buffering-once-and-re-emitting
is the streaming-safe path here.

### Test fixture fix (org-create-reissue.test.ts)
`upstreamResponds` now uses `mockImplementation` (fresh Response per call) instead of
`mockResolvedValue` (one shared Response). The workos-mode interception makes several fetches
per `POST /api/orgs`; a single shared Response body cannot be consumed more than once. The
assertions are unchanged — this is a fixture correctness fix exposed by the new behavior, not
an assertion weakening.

### Coverage (DWD-6 — no python cdo_s5 scenario; auth-proxy unit + integration only)
- `lib/org-create-workflow.test.ts` (NEW) — the full fault-injected matrix: pre-check-409 →
  synthesized 409 + ZERO provision calls; create fail → 502; membership fail after 1 retry →
  502 + compensation attempted; membership-retry-succeeds → forwards; backend non-201 →
  compensation (1 retry) + status relayed; compensation-fail → `workos.org_compensate.fail`
  with orphan id + status still relayed; happy path → `X-Provisioned-Org-Id` carried + 201 +
  `org_create.intercepted` emitted.
- `lib/user-auth/workos.test.ts` — the three ops via constructor-injected `mockFetch`:
  success shape, Bearer-API-key auth + 5s AbortSignal, WorkOS 4xx/5xx/network → typed
  `service_error`.
- `app.test.ts` — the workos-mode integration arm: provision+forward carrying
  `x-provisioned-org-id`; 409 pre-check → ZERO WorkOS egress; `applyOrgCreateReissue` still
  fires on the relayed 201; client-supplied `x-provisioned-org-id` stripped on the org route
  AND on a non-org route (every route); dev-mode straight-through (single backend call, no
  WorkOS egress).

### Verification
`cd auth-proxy && SKIP_DOCKER_ACCEPTANCE=1 npx vitest run` → 16 files, 276 passed, 5 skipped
(the multi-replica docker suite skips: no `dashboard-chat/auth-proxy:bazel` image + the flag).

## Step 05-04 — ui/ driver foundation (onboarding-driver + ApiError + fetchAuthConfig)

The relocated client-driven onboarding flow POLICY now lives in `ui/app/lib/onboarding-driver.ts`
as a PURE, collaborator-injected module (no DOM/React/network). The surfaces (05-05) consume it;
in-flight UI is the surface's local concern (DR-1).

### Layer 1 — status-carrying client error (`backendClient.ts`)
- `ApiError extends Error { status, body }` — thrown on every non-2xx by apiGet/apiPatch/apiPost/
  apiUpload INSTEAD of a plain `Error`. The original message text is preserved (`"<VERB> <path>
  failed with status N"`) and it stays `instanceof Error`, so the catalog's existing call sites
  (read `err.message`, fall back to fixtures) are untouched. `body` = the parsed JSON error body,
  or `null` when the body is not JSON-parseable.

### Layer 2 — mode discovery (`bootstrap.ts`)
- `fetchAuthConfig(): Promise<{ mode: "dev" | "workos" }>` — GET `/api/auth/config`, Zod-validated
  at the boundary (`z.object({ mode: z.enum(["dev","workos"]) }).passthrough()` — unknown future
  fields ignored), and the resolved promise MEMOIZED at module level (fetched at most once per app
  load). `login()/handleCallback()/extractCode()` unchanged.

### Layer 3 — the flow policy (`onboarding-driver.ts`)
`createOnboardingDriver({ client, report, log })` returns async methods that each probe/POST, map
the outcome, POST the past-tense report (the StateProxy.postEvent sink), and log an audit entry.

- **Status → cause (ADR-050 §c)** — org-create: `201 {id,name}`→`org_created`; `409`→
  `org_create_failed{org_name_taken, org_name}`; `400|422`→`org_create_failed{org_name_invalid,
  org_name}`; any-other / network / timeout→`org_create_failed{org_create_failed}`; `401`→auth
  gate (NO report). Default project: `201`→`project_created`; `401`→auth gate; else→
  `project_create_failed`.
- **Definitive-answers-only (INV-PCO / earned-trust)** — the Phase-B probe `GET /api/orgs/me`
  reports ONLY `200`→`org_found` and `404`→`org_not_found`. Transport errors (5xx / network /
  timeout) → NO report; the document stays awaiting and the surface re-probes. `401` → auth gate.
- **Probe-first convergence (lost-201 dedup)** — `retryProject()` re-probes `GET /api/projects`
  BEFORE re-POSTing: a non-empty list → `scope_resolved` with NO duplicate POST (a prior 201 was
  actually persisted); an empty list → re-POST → `project_created`/`project_create_failed`.
- **Initial-scope resolution** (ported `resolveInitialScopeFn`) — probe `GET /api/projects`; a
  resolvable project → `scope_resolved`; empty → `no_projects_found`.
- **Audit trail (ratification amendment 3)** — each posted event logs `info("onboarding-driver.
  <type>.reported", { event, region_state })` via the injected `createLogger('onboarding-driver')`.
  NEVER `console.*`. `region_state` = `onboarding` for org_* events, `projectContext` otherwise.
- The injected `client` port mirrors the catalog contract (non-2xx → throws `ApiError`; 2xx →
  unwrapped JSON:API body; network/timeout → plain non-ApiError throw), so the whole matrix is
  unit-testable. Wire event shapes reuse `@dashboard-chat/ui-state-wire` (the closed union).

### Verification
`cd ui && npx vitest run` → 22 files, 249 passed. `cd ui && npm run typecheck` → clean.
New: `onboarding-driver.test.ts` (21 tests). Extended: `bootstrap.test.ts` (+4 fetchAuthConfig),
`backendClient.test.ts` (+3 ApiError — instanceof Error + message + {status,body} preserved).

---

## Step 05-05 — ui/ surfaces (login mode-discovery + onboarding POST+report + app-shell gate)

DELIVER via Outside-In TDD. Layer = `ui/` (thin React consumers of the 05-04 driver). Three surfaces:

- **login.tsx** (§d mode discovery): on mount fetches the memoized `fetchAuthConfig()`; renders NO sign-in
  affordance until the mode resolves (neutral waiting surface — no flash of a dev button in workos mode).
  `mode==='dev'` → "Sign in (dev)"; `mode==='workos'` → plain "Sign in". Both call the UNCHANGED `login()`.
  `hasSession()` → `Navigate("/")` short-circuit preserved.
- **onboarding.tsx** (POST+report; DISPLAY RULE): `OrgNameForm` submit drives the REAL POST `/api/orgs` via the
  driver (`reportOrgCreateResult`), in-flight UI is LOCAL `useState(busy)` (DR-1 — the document never shows an
  in-flight org state). `ProjectNameForm` DELETED (+ its `create_project_submitted` post). Phase D is AUTOMATIC:
  a ref-latched effect fires `driver.createDefaultProjectAndReport()` ONCE on entering the project phase
  awaiting a scope report; the project surface is a progress view. The `project_selected → refreshOrgGlobal()
  → navigate("/")` (f) effect is byte-preserved.
- **app-shell.tsx** (§e.4/§f gate): `ONBOARDING_ACTIVE_STATES = {needs_org, error_recoverable}`; the
  `phase==='rejected'` branch DELETED (closed-union crash-class model retired it); waits on
  `awaiting_org_report` (also the anonymous zero state); on `awaiting_org_report` fires the driver's Phase-B
  probe (`probeAndReportOrg`); `no_projects → /onboarding` routing kept (the driver auto-creates from there).

### BINDING DISPLAY RULE (ratification amendment 2) — evidence

The shipped `ErrorSurface` rendering `<p>Cause: {cause}</p>` was THE anti-pattern; it is RETIRED. No raw cause
tag (`org_name_taken` / `org_name_invalid` / `org_create_failed` / `project_create_failed`) renders anywhere a
failure is shown:

- **Re-edit causes** (`org_name_taken` / `org_name_invalid`) → friendly, server-owned inline helper copy on the
  org form, rendered from `regions.onboarding.context.org_validation_error.message` (e.g. "That organization
  name is already in use — try another"). The user stays on the form to re-edit.
- **Retry class** (`org_create_failed` / `project_create_failed` → `error_recoverable`) → a distinct
  "Something went wrong on our end" surface with a "Try again" control (org → `driver.probeAndReportOrg()`
  probe-first; project → `driver.retryProject()`).

Acceptance assertions (RED-first on `onboarding.test.tsx`): the 409/422 paths post `org_create_failed{cause}`
to the wire (`posted[]`) AND assert `screen.queryByText(<rawTag>)` is null; the `error_recoverable` surfaces
assert `/something went wrong on our end/i` is present and the raw tag + `/Cause:/` are absent. Litmus held:
reverting `onboarding.tsx` leaves these RED (the old `Cause: {cause}` render trips the "no raw tag" assertion).

### Audit trail

Raw machine cause tags live in the driver's `createLogger('onboarding-driver')` audit entries ONLY (each POSTed
outcome event + region state). The surfaces narrate via `createLogger` (never `console.*`):
`onboarding.org_create.submit`, `onboarding.project.auto_create.start`, `onboarding.project_selected.entering_app`,
`login.config.failed`. Confirmed in the vitest stdout (e.g. `[onboarding-driver] onboarding-driver.org_create_failed.reported`).

### Environment note (node_modules symlink)

`@dashboard-chat/ui-state-wire` resolves through the workspace symlink to the MAIN checkout's
`shared/ui-state-wire`, where `anonymousStateDocument().regions.onboarding.state` is still `verifying` (the
`awaiting_org_report` zero-state from CDO-S1 lives on this worktree's source but is not the resolved package).
Tests therefore construct `awaiting_org_report` documents EXPLICITLY rather than relying on the package default;
the app-shell gate treats `verifying` and `awaiting_org_report` identically as the waiting surface, so the
pre-first-frame behavior degrades gracefully. No runtime impact — the real ui-state service emits
`awaiting_org_report` independently of this type-only default.

### Out-of-scope test touched

`routing.test.tsx` ("renders the sign-in button at /login") is NOT in files_to_modify but broke on the §d
contract (login no longer renders a button before config resolves). Updated minimally: a `vi.mock` stub of
`fetchAuthConfig → { mode: "dev" }` so the route surfaces the dev button. This is a requirement-change update
(ADR-050 §d, user-ratified), not a gamed assertion — the asserted behavior ("sign-in available at /login") is
preserved.

### Verification

`cd ui && npx vitest run` → 22 files, 247 passed. `cd ui && npm run typecheck` → clean.
Reworked: `onboarding.test.tsx` (DISPLAY RULE + POST+report + Phase-D auto + (f) effect), `login.test.tsx`
(mode discovery), `app-shell.test.tsx` (gate: `{needs_org, error_recoverable}`, no rejected branch,
`awaiting_org_report` wait, Phase-B probe fires).

---

## Step 05-06 — Compose env deltas (single-cut) + full acceptance integration gate

The single-cut compose deltas from ADR-048 §4 landed and were verified by the FULL
org-onboarding acceptance suite against a stack rebuilt from this worktree (ui-state +
auth-proxy + api). This is the CDO-S5 integration regression — config + gate step, no
new unit test (RED_UNIT recorded SKIPPED, NOT_APPLICABLE).

### Compose keys changed (docker-compose.yml only)

- **ui-state service** — REMOVED `FAKE_WORKOS_URL`, `AUTH_MODE`, `BACKEND_URL`
  (`UI_STATE_BACKEND_URL`), and the entire `extra_hosts:` (`host.docker.internal`)
  block. The tier is now zero-egress (config.ts is Redis-only since 05-02); the
  container BOOTS with these vars absent. KEPT: PORT, REDIS_URL, FLOW_EVENT_MAXLEN,
  ENVIRONMENT, NWAVE_HARNESS_KNOBS, ports.
- **auth-proxy service** — ADDED `WORKOS_BASE: ${WORKOS_BASE:-https://api.workos.com}`.
  auth-proxy is now the sole WORKOS holder + sole AUTH_MODE reader; the upstream
  target is an explicit compose key rather than a code default.
- **api / api-full** — VERIFIED clean (no AUTH_MODE/WORKOS_* keys). NO-OP.
- **agent** — left untouched (ADR-048 R3, out of scope).
- **docker-compose.override.yml** — verify-only; api has no AUTH_MODE pin,
  auth-proxy `AUTH_MODE: dev` left. NO-OP (no change).

### ui-state boot confirmation

`docker logs dashboard-ui-state` → `{"event":"flow.startup","port":8788}` — single
clean startup, no restart, no config-validation crash. The split-brain failure class
is now unrepresentable in compose config.

### Integration result

13 passed / 1 expected RED (the carried-forward UPSTREAM-S3-1) — see deliver-summary.md.

## 05-07 — review-fix (APPROVE-WITH-NITS → resolved)

The adversarial review (nw-software-crafter-reviewer) returned APPROVE-WITH-NITS:
all 6 binding requirements PASS, no BLOCKER/HIGH, no testing theater. This small
revision pass addresses the five findings without regressing 05-01..05-06.

- **D4 (raises fidelity to BINDING amendment 3)** — `onboarding-driver.ts` `postAndLog`
  now logs the RESULTING region state read off `report()`'s returned
  `ChatAppStateDocument` (`doc.regions[region].state`) instead of the region NAME.
  The audit entry carries the posted `event`, the `region` name, AND the
  `region_state`. Driver tests assert the resulting state for both an onboarding-region
  event (org_created → `ready`) and a projectContext-region event
  (project_created → `project_selected`). Litmus: reverting the postAndLog change
  turns the D4 audit test RED.
- **D3** — the generic `org_create_failed` payload on BOTH the non-ApiError
  (network/timeout) path and the 5xx ApiError else-branch now carries `org_name`
  uniformly, matching the 409/400/422 arms. Additive per the wire contract
  (`org_name?: string`). Driver tests assert org_name on the 500 + network paths.
- **D2** — added `error_recoverable` self-heal convergence coverage to the
  session-chat machine test (the machine already supported these transitions; only
  the tests were missing). SH1: error_recoverable + a fresh `session_list_loaded`
  report → converges to `session_list_loaded` with the reported sessions. SH2:
  error_recoverable + `refresh_session_list` → re-enters `awaiting_session_list_report`.
- **D1** — added `400 → org_name_invalid` to the route `it.each` in
  `onboarding.test.tsx`, closing the route-level gap so all three org_name_invalid
  triggers (400/422 + the 409 sibling) are route-covered.
- **D5** — added a probe de-bounce test to `app-shell.test.tsx`: the Phase-B probe
  (`driver.probeAndReportOrg`) fires EXACTLY ONCE and does NOT re-fire after the
  document transitions away from `awaiting_org_report` (the useEffect dep array
  de-bounce).

**Result:** ui 250 passed, ui-state 189 passed, ui typecheck clean. No regression of
the BINDING display rule (no raw cause tag), ui-state zero-egress, or the three legacy
wire members.
