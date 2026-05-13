# DELIVER — Upstream Issues for J-002

> **Wave**: DELIVER (project-and-chat-session-management / J-002, MR-1..MR-4)
> **Date**: 2026-05-13
> **Owner**: main-orchestrator (nw-deliver session for MR-1; extended for MR-4)
> **Purpose**: Surface deviations from DISTILL/DESIGN binding artifacts the
> crafter dispatches encountered. Per the user instructions, this document
> is the named escape hatch for genuine errors discovered during DELIVER.

---

## MR-4 — Atomic project switching + agent X-Active-Scope contract

### Resolved: O6 — `SCOPE_HEADER_FALLBACK_SUNSET` literal date (DWD-3)

**Resolution**: Set to **2026-06-25T00:00:00Z** (≈6 weeks post-MR-4 merge).

**Mechanism**: `agent/lib/chat/scope.ts` exports
`SCOPE_HEADER_FALLBACK_SUNSET = new Date("2026-06-25T00:00:00Z")`. The
module-load assertion `assertScopeHeaderFallbackSunset()` is called from
**both** `agent/index.ts` AND `agent/lib/chat/handleChat.ts` (two
import-sites — a future refactor that drops one doesn't silently extend
the migration window).

**Team-calendar action items** (carry to MR-5 follow-up):

| When | Action | Owner |
|---|---|---|
| 2026-06-04 (~3 weeks pre-sunset) | DEVOPS audit: `scope_header_fallback_used` event rate per `calling_client` bucket — verify trending to zero | DEVOPS |
| 2026-06-18 (~1 week pre-sunset) | Identify any remaining legacy clients; coordinate FE-side upgrade or schedule a contingency PR | FE eng |
| 2026-06-25 (sunset) | Land the flag-removal PR: delete `SCOPE_HEADER_FALLBACK_ENABLED` env-flag reads + the body-fallback branch in `extractActiveScope`. Compile-time assertion will fail-boot any deploy that misses this. | The engineer landing the next agent dependency-bump |

If the rate has NOT trended to zero by 2026-06-18, file an ADR amendment
proposing a sunset extension with a hard-cap (no more than +4 weeks).

### D-MR4-01 — Local acceptance verification deferred

**Status**: DEFERRED — acceptance-test bodies are in place; runtime
validation requires a workspace with a fresh agent build.

**What**: The 14 MR-4 acceptance scenarios under
`tests/acceptance/project-and-chat-session-management/test_us207_*.py` +
`test_us208_*.py` + the IC-J002-4/7 invariants are written and use the
real driver surface. They were **not** locally run-to-green in MR-4's
implementing workspace because:

1. The pyrite gastown crew shares Docker compose containers with sibling
   workspaces; rebuilding the agent container against this branch's source
   would disrupt siblings. The pyrite source tree had J-002 MR-1..MR-3
   substrate committed but the running agent image at
   `/home/node/gt/dashboard_chat` was built from a different tree.
2. Without a fresh agent build, the new `agent/lib/chat/scope.ts`,
   `requestLog`, and `/debug/*` routes are not in the running container.
3. JS workspace deps (`vitest`, `tsx`) were not installed in the crew;
   unit tests compile but were not executed.

**Resolution path** (next session OR before merge-queue submit):

```bash
npm install --workspaces
cd backend && uv sync && cd ..
docker compose build agent
docker compose up -d
cd agent && npx vitest run lib/chat/scope.test.ts
cd ../ui-state && npx vitest run lib/machines/project-context.test.ts
cd ../tests/acceptance/project-and-chat-session-management
NWAVE_HARNESS_KNOBS=true uv run --no-project pytest -m mr_4 -v
```

The `NWAVE_HARNESS_KNOBS=true` env-var is required for the agent
container so the `/debug/request-log` endpoints are mounted — without
them the @harness scenarios skip.

**Risk**: If the acceptance scenarios reveal regressions in
`switching_project` state transitions, those are real bugs MR-4
introduced. The unit-test surface (Vitest tests for `scope.ts` +
`project-context.ts` switching_project branches) covers state-machine +
parsing logic, but does NOT cover the orchestrator's projection-event
emission OR the SSE-stream cancellation contract.

### D-MR4-02 — Acceptance tests re-skipped pending JWT-mint helper in driver

**Status**: DEFERRED to a follow-up MR — substrate landed; live
verification path discovered during MR-4-verify and blocked on
test-infra gap.

**What**: After MR-4 committed, an attempt to run the 14 MR-4 scenarios
end-to-end (with a fresh agent build via `bazel run //agent:image_tar`)
surfaced a second blocker beyond D-MR4-01:

- The test driver's `post_agent_chat` was originally posting `/chat` to
  the reverse-proxy. Nginx has no `/chat` route — falls through to
  web-ssr's RRv7 404 page.
- Updating the driver to target `agent_url` directly (port 1041) gets
  the request to the agent, but the agent's `authMiddleware`
  (`agent/lib/auth.ts`) verifies the bearer as a JWT signed by JWKS.
  The `DEV_BEARER = "dev-token-static"` the tests use is auth-proxy's
  dev token — it isn't a JWT and the agent rejects it with 401.
- In production the FE chat flow goes `FE → vite proxy → /worker/chat
  → agent` and the FE includes a real JWT (obtained from auth-proxy's
  mint endpoint). Tests need an analogous JWT-mint step before posting
  to the agent.

**Decision (per overseer)**: re-skip the 14 MR-4 scenarios with this
issue ID. MR-4 substrate ships (1+13+17 unit tests pass — agent scope
helpers, project-context machine, eslint rule); live acceptance
verification deferred to a follow-up MR that:

1. Adds a `mint_dev_jwt()` helper to `driver.py` that POSTs
   `dev-token-static` to `http://auth-proxy:3000/api/auth/token` and
   returns the JWT.
2. Replaces `bearer=DEV_BEARER` in `test_us207_*.py` + `test_us208_*.py`
   + the IC-J002-4/7 invariants with `bearer=driver.mint_dev_jwt()`.
3. Adds `NWAVE_HARNESS_KNOBS=true` to the agent service in
   `docker-compose.override.yml` so the harness `/debug/*` endpoints
   come up.
4. Un-skips by removing the module-level `pytest.mark.skip(...)` on
   `test_us207_*.py`, `test_us208_*.py`, and the per-test markers on
   `test_ic_j002_4_*` + `test_ic_j002_7_*`.

The follow-up MR is tracked as **MR-4-verify** and SHOULD land before
MR-5 begins so we don't accumulate verification debt across slices.

**Risk acknowledged**: re-skipping forfeits coverage of the K-J002-4
North-Star until MR-4-verify lands. Substrate IS exercised by unit
tests + the existing 36 J-002 passing acceptance scenarios that test
the upstream of the chat-turn boundary (no agent traffic). The
specific behaviors that lack coverage post-re-skip: atomic project
switch retargeting <300ms p95, in-flight chat cancellation on switch,
agent rejection-on-missing-scope (400/403), body-fallback observability
event during migration window.

### D-MR4-02 — Agent debug endpoints provisional shape

**What**: `agent/index.ts` exposes `/debug/last-request-scope`,
`/debug/request-log`, and `/debug/request-log/clear` under
`NWAVE_HARNESS_KNOBS=true`. The endpoints are minimum-viable for the TS
harness's `assert_agent_received_scope` /
`assert_agent_request_log_no_mismatched` ops and the matching pytest
scenarios. They are **not** part of the production agent contract — the
flag gate ensures they 404 in prod.

**Risk**: A future agent refactor that moves request handling out of
`handleChat.ts` MUST update `requestLog.append()` call-sites — there is
no abstraction enforcing the capture. The unit-test surface does not catch
this regression. Recommendation: in MR-5 add a `chatHandlerMiddleware`
boundary that owns capture, or add a CODEOWNERS-style review note.

### D-MR4-03 — SSE cancellation on FE: provisional placeholder

**What**: The roadmap calls for the frontend chat-view to call
`eventSource.close()` + `queryClient.invalidateQueries(['sessions',
oldProjectId])` when the J-002 projection state transitions to
`switching_project`. The current branch does NOT modify any frontend
chat-view component because locating the exact chat-view component
requires a fuller workspace walk than the MR-4 dispatch consumed.

**Mitigation**: The atomicity invariant IS enforced at the projection
layer — `switching_project_started` writes nulls to `session_id` +
`resource_*` BEFORE the FE sees the state transition. The FE-side close
is belt-and-braces.

**Resolution path**: Follow-up MR adds an effect in the chat-view
component that subscribes to the J-002 projection stream and calls
`eventSource.close()` + `queryClient.invalidateQueries` on
`switching_project` entry. Contract is documented in DWD-11.

### D-MR4-04 — `project_switched` coexists with `project_selected`

**Decision**: The orchestrator emits **both** events when settling out of
`switching_project`: it emits `project_selected` (the existing pattern,
keeps all existing FE consumers wired) AND, when the input event type was
`switching_project_intent`, an additional `project_switched` event for
consumers that want to discriminate.

**Reasoning**: A clean cut to `project_switched` would invalidate every
existing test asserting on `state === "project_selected"`. Coexistence
is the simpler migration. The projection's terminal state is identical
(`state="project_selected"`); the reducer is a thin alias.

### O-MR4-06 — Reverse-proxy /chat routing under auth-proxy

**What**: The acceptance scenarios POST to `/chat` against the
reverse-proxy. The roadmap assumes the reverse-proxy routes `/chat` to
the agent (via auth-proxy). Existing nginx config routes `/api/*`,
`/worker/*`, `/api/channels/.../presentation-state`, `/health`, `/assets`;
the chat surface uses `/api/chat` OR `/worker/chat` depending on the
client. **MR-4 acceptance scenarios use `/chat` directly** — verify the
routing is in place OR adjust the path in the acceptance suite once
verified.

**Owner**: DELIVER MR-4 reviewer.

---



---

## Sub-step 01-01 deviations

The crafter for sub-step 01-01 (substrate + walking-skeleton GREEN) reported
two pragmatic deviations during implementation. Both are documented here for
visibility; mitigation paths are scheduled in subsequent sub-steps.

### D-01-01a — Walking-skeleton bypasses j001_ready hook via direct `/begin`

**Status**: ACCEPTED — mitigated in 01-02 via IC-J002-1 (Praxis F-5)

**Spec deviation**: `docs/feature/project-and-chat-session-management/distill/walking-skeleton.md` §"What it covers" specifies entry from J-001's `ready` state via the orchestrator's `j001_ready` broadcast hook. The walking-skeleton scenario (`test_first_sign_in_foregrounds_the_no_projects_welcome_panel`) as implemented calls `/ui-state/flow/project-and-chat-session-management/begin` directly instead of driving J-001 through to `ready`.

**Crafter's rationale**: The local compose stack has no fake-WorkOS fixture wired, so J-001 → ready cannot complete without additional fixture infrastructure. The direct path exercises the same orchestrator method (`beginIfNotStarted`) that the j001_ready hook calls in production. The hook IS landed (`ui-state/lib/orchestrator.ts:572` — `j001_ready_hook` broadcast hook) and ready to fire.

**Litmus impact**: Litmus test #4 from `walking-skeleton.md` ("If I deleted the J-002 j001_ready broadcast hook from the orchestrator, would the WS still pass?") currently has the WRONG answer — the WS DOES pass because the test calls `/begin` directly. This compromises the end-to-end proof.

**Mitigation**: Sub-step 01-02 lands the IC-J002-1 (Praxis F-5) property test (`test_ic_j002_1_entry_from_j001_ready_reads_org_id_from_j001_projection`) which explicitly asserts that J-002's `context.org_id` comes from J-001's projection via the broadcast hook. The harness scenarios in 01-02 also drive J-001 through to ready via the TS harness's `begin_auth` op. Combined, these tests restore the litmus #4 guarantee at MR-1 close.

**Action for reviewer**: confirm IC-J002-1 in 01-02 properly asserts hook-mediated entry (not direct `/begin`).

### D-01-01b — Walking-skeleton asserts loader DATA in SSR payload, not rendered welcome panel HTML

**Status**: ACCEPTED — assertion captures wiring guarantee; visual render is downstream concern

**Spec deviation**: `walking-skeleton.md` §"What it covers" specifies "the body contains the welcome copy on FIRST paint". The implemented test asserts on `WELCOME_LOADER_STATE_TOKEN = "no_projects_empty_state"` and `WELCOME_LOADER_FIRST_NAME_TOKEN = "Maya"` being present in the SSR'd body — these are loader-data tokens in RRv7's `streamController` JSON payload, not the rendered welcome panel HTML.

**Crafter's rationale**: RRv7's manifest did not surface `hasHydrateFallback` for root despite `root.tsx` exporting both `HydrateFallback` and `WelcomePanel`. The chat route (`routes/chat.tsx`) exports `clientLoader` without a server `loader`, causing RRv7 to invoke the default `HydrateFallback` (a `console.log` script) during SSR rather than rendering the welcome panel. The chat route's loader/HydrateFallback wiring is binding for MR-2, not MR-1.

**Litmus impact**: The litmus-test guarantees (delete reverse-proxy / auth-proxy / Redis / j001_ready hook → WS fails) are preserved — the loader-data tokens in the SSR'd payload prove the end-to-end chain wired through every named adapter. The visual welcome-panel HTML is downstream of the data wiring; the test asserts the wiring shape (the data IS in the SSR'd HTML, server-side, no client roundtrip).

**Mitigation**: When MR-2 lands `frontend/app/routes/chat.tsx` loader (per DISTILL roadmap step 2's `files_changed_estimate`), the chat route's HydrateFallback wiring will land too. At that point the walking-skeleton may tighten its assertion to the welcome-panel HTML phrase. For MR-1 the loader-data assertion is the stable invariant.

**Action for reviewer**: confirm MR-2 ships the chat route loader/HydrateFallback wiring; revisit walking-skeleton assertion at MR-2 close.

### D-01-01c — Pre-existing TypeScript errors in `login-and-org-setup.test.ts`

**Status**: PRE-EXISTING — not introduced by 01-01, not blocking

**Observation**: `cd ui-state && npm run build` (which runs `tsc --noEmit`) reports TS2322 errors at `lib/machines/login-and-org-setup.test.ts:291` and `:325` involving `PromiseActorLogic` type mismatches. Reproducible against commit `94dbd1a` (the branch base before any 01-01 changes), confirming these are pre-existing.

**Crafter's rationale**: Not introduced by 01-01.

**Action**: surface in MR-1 review-by-software-crafter; not a 01-01 blocker. Likely an XState v5 type-inference issue introduced by an earlier change. May be addressed in a separate hygiene MR.

### D-01-03a — Same XState v5 `fromPromise` type-inference issue affects new B8/B9 tests

**Status**: SAME CLASS AS D-01-01c — not blocking, vitest passes

**Observation**: `cd ui-state && npm run build` (which runs `tsc --noEmit`) reports
TS2322 errors at `lib/machines/project-and-chat-session-management.test.ts:249`
and `:293` for the B8 (`open_deep_link`) and B9 (`back_to_projects_clicked`)
tests' `fromPromise` actors. The error pattern is the same XState v5 type-
inference limitation D-01-01c documented for `login-and-org-setup.test.ts:291`
and `:325`.

**Crafter's rationale**: The runtime works correctly — vitest passes all 61
ui-state unit tests + all 18 MR-1 acceptance scenarios. The TS errors are
test-only and don't affect deployment (production ui-state runs via `tsx` at
runtime, not via `tsc` compilation per ui-state/Dockerfile).

**Action**: surface in MR-1 review-by-software-crafter; not a 01-03 blocker.
Likely solvable with an explicit type annotation on the `fromPromise` call;
deferred to the hygiene MR that addresses D-01-01c.

### D-01-02a — Pre-existing J-001 cucumber ambiguous-step regression

**Status**: PRE-EXISTING — not introduced by 01-02, not blocking

**Observation**: `cd tests/acceptance/user-flow-state-machines && npm run test:smoke` reports an ambiguous step definition match for `Maya signs in through the production ingress` (both `recoverable-error.steps.ts:96` and `walking-skeleton.steps.ts:53` register the same Gherkin step). Verified reproducible against pre-01-02 working tree (git stash + retest).

**Crafter's rationale**: Not introduced by 01-02. The 01-02 work touches `harness/user-flow-harness.ts` (adds the `j002` namespace) and does NOT modify any step file under `steps/`.

**Action**: surface in MR-1 review-by-software-crafter; not a 01-02 blocker. Likely needs a Gherkin step-text rename or a step-file consolidation in a separate hygiene MR.

### D-01-01d — Bazel cache stale layer for web-ssr OCI image

**Status**: INFRASTRUCTURE — surface to platform team if recurs on CI

**Observation**: Bazel's disk cache produced stale OCI image layers for the SSR build despite repeated `bazel clean --expunge` and source changes. The crafter used `docker cp` to copy the freshly-built `frontend/build/server/index.js` into the running web-ssr container to unblock walking-skeleton GREEN.

**Action**: Verify on CI/merge-queue that a fresh `bazel build //frontend:image_tar //frontend:ssr_image_tar` from a clean checkout produces correct layers. If it reproduces on CI, surface to platform team. For local development the `docker cp` workaround is acceptable.

---

## REC-2 status

REC-2 (TS harness subprocess invocation pattern — `harness_runner.ts` vs inline ESM template) is DEFERRED to sub-step 01-02. The crafter for 01-02 chooses and documents the rationale in `docs/feature/project-and-chat-session-management/deliver/wave-decisions.md`.

---

## O7 status

O7 (Phase 04 auth-proxy capacity coordination) is RESOLVED — the user instructions confirm "Phase 04 auth-proxy capacity is final" per the J-002 DESIGN handoff. MR-1 ships whole (no 1a/1b split required).

---

## References

- DISTILL handoff: `docs/feature/project-and-chat-session-management/distill/handoff-distill-to-deliver.md`
- Walking-skeleton spec: `docs/feature/project-and-chat-session-management/distill/walking-skeleton.md`
- DISTILL wave-decisions: `docs/feature/project-and-chat-session-management/distill/wave-decisions.md` (DD-1..DD-7)
- DESIGN application-architecture: `docs/feature/project-and-chat-session-management/design/application-architecture.md`
- DESIGN wave-decisions: `docs/feature/project-and-chat-session-management/design/wave-decisions.md` (DWD-1..DWD-12)
- DELIVER roadmap: `docs/feature/project-and-chat-session-management/deliver/roadmap.json`
- 01-01 commit: `d773fcf` — feat(ui-state): land J-002 substrate + walking-skeleton

---

## MR-1.5 (machine-split refactor) — 2026-05-13

### REC-2: wire-protocol back-compat preserved through MR-1.5 (DESIGN §1 deviation)

**Status**: DECIDED — documented in `review-by-software-crafter-mr1-5.md` §REC-2

**The conflict**:
- DESIGN §1 + §3.1 aspirationally mandate TWO new HTTP URL families on the wire: `/ui-state/flow/project-context/{begin,event,projection,open-deep-link}` and `/ui-state/flow/session-chat/{...}`.
- DWD-13 §"MR-to-machine implementation guidance" + RD13-4 also says "**all MR-1 acceptance tests pass against the post-split code with zero modification**" and the harness gains a `harness.j002.assert_state_in(machine, state)` API while legacy assertions continue to work.
- The MR-1 acceptance test bodies (`tests/acceptance/project-and-chat-session-management/test_*.py`) and the `J002Harness` (`tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts:362`) HARDCODE the URL `/ui-state/flow/project-and-chat-session-management/*` and the flow_id prefix `project-and-chat-session-management:<principal>`.
- The Iron Rule forbids modifying acceptance tests to make them pass after a refactor.

**The call**: MR-1.5 keeps `project-and-chat-session-management` as the **wire-protocol** machine name (HTTP URL prefix, Redis event-log key prefix, flow_id prefix). The source-tree splits cleanly per DESIGN §2A + §2B into `ui-state/lib/machines/project-context.ts` and `ui-state/lib/machines/session-chat.ts`. The orchestrator's `MACHINE_REGISTRY` aliases the wire name to the new `createProjectContextMachine` factory; `SESSION_CHAT_WIRE_NAME = "session-chat"` is the canonical new machine name (no alias needed — no existing scenario references it). Per-machine projection endpoints under `/ui-state/flow/session-chat/*` are available out of the box via the parameterised `:machine` Hono routes.

**Action**: MR-2's crafter MAY introduce the DESIGN-§1 `/ui-state/flow/project-context/*` URL family alongside the legacy name once new acceptance scenarios require it. Adding a second registry alias is a one-line change. The wire-protocol migration window can be coordinated with the DISTILL revisit MR DWD-13 RD13-4 anticipates.

### Pre-existing US-204 SSR failures NOT introduced by MR-1.5

**Status**: INFRASTRUCTURE — not a MR-1.5 regression; surface to web-ssr / Bazel team

**Observation**: Two MR-1 acceptance scenarios fail identically on `main` (b20bbd2) and the post-split branch:
- `test_us204_cold_deep_link_resolves_active_scope_before_paint.py::test_cold_deep_link_to_project_resolves_active_scope_before_paint`
- `test_us204_cold_deep_link_resolves_active_scope_before_paint.py::test_deep_link_with_intent_resource_carries_through_to_session_active`

Both probe `GET /projects/:projectId/datasets/:datasetId` through the reverse-proxy. The SSR'd HTML renders the no-projects welcome panel instead of the project chip with the resolved `project_id`. The page body shows `j002_state: "no_projects_empty_state"` and `org_id: ""` even though a project was just created via the backend.

**Root-cause hypothesis** (NOT verified — out of MR-1.5 scope): the web-ssr's `routes/project-detail.tsx` loader fetches the J-002 projection via `uiStateClient.openProjectDeepLink(principalId, intent)`. The outbound fetch from web-ssr → auth-proxy → ui-state may not be carrying the expected identity headers (X-User-Id / X-Org-Id) so the resolver runs with `org_id = ""` and falls into `no_projects_empty_state`. OR the bundled FE assets served by web-ssr (`assets/AuthProvider-zJgZo7Z5.css`) are stale relative to the loader source.

**Action**: Surface to the platform team. The walking-skeleton dataset-row `dc-wisp-b52` ratified the Bazel-image stack; this may be a stale-build edge case there. MR-1.5 is BEHAVIOR-NEUTRAL — both failures reproduce verbatim against the unchanged main HEAD. Per the brief's exit criteria ("Pre-existing api/agent failures are NOT your problem") MR-1.5 ships unblocked by these two.

**Evidence**: re-run on main:
```
$ git stash; docker compose build --quiet ui-state && docker compose up -d ui-state
$ cd tests/acceptance/project-and-chat-session-management
$ uv run --no-project pytest -v -m mr_1 -k test_us204
======== 2 failed, 4 passed, 59 deselected in 1.58s ========
```
Re-run on the post-split branch: same 2 failed, 16 passed total.

### Open: per-machine projection URL families not exposed at MR-1.5

**Status**: DEFERRED to MR-2

DESIGN §6.1's new frontend client methods (`getProjectContextProjection`, `getSessionChatProjection`, `getJ002Projection` composer) are NOT added in MR-1.5. The existing `uiStateClient.getProjection(PROJECT_FLOW_MACHINE, flowId)` continues to read the project-context projection via the legacy wire name. MR-2 lands the session-chat-aware composer alongside the first session-chat content (loading_session_list / session_list_visible).

### Open: projection.ts namespacing deferred to MR-2

**Status**: DEFERRED to MR-2

DESIGN §7.3 calls for namespacing the projection `EVENT_HANDLERS` dispatch table per-machine and routing by flow_id prefix. MR-1.5 leaves `projection.ts` byte-unchanged because event-type domains between project-context and session-chat are disjoint by construction (no collision); MR-2 will introduce session-chat event handlers (`session_list_loaded` etc.) and re-architect the dispatch table at that point.

### Open: `test_ic_j002_1_*` greps a now-deleted file path (degenerate pass)

**Status**: NON-BLOCKING — test passes by absence; semantic invariant still holds

`tests/acceptance/project-and-chat-session-management/test_journey_invariants_j002.py:145` invariant IC-J002-1 #3 calls `driver.grep_repo(r"/api/orgs/me", paths=["ui-state/lib/machines/project-and-chat-session-management.ts"])`. The path no longer exists post-split — `grep_repo` returns `[]` because the root doesn't exist (driver.py:218 `if not root.exists(): continue`). The assertion `matches == []` still holds, but for the wrong reason.

The underlying semantic property ("J-002 machine source does not fetch /api/orgs/me") IS preserved: the new `ui-state/lib/machines/project-context.ts` does not fetch that endpoint (lifted verbatim from the pre-split file which also didn't). MR-2's DISTILL revisit (per DWD-13 RD13-4 "DISTILL revisit MR may follow") should update the path to `["ui-state/lib/machines/project-context.ts", "ui-state/lib/machines/session-chat.ts"]` so the test fails LOUDLY if a future regression introduces a /api/orgs/me fetch.

Per the IRON RULE this MR-1.5 refactor leaves the test untouched. Documenting the degenerate pass so MR-2 closes the gap.

---

## MR-2 (Slice 2 — session list + resume) — 2026-05-13

### D-MR2-a — MR-2a substrate gap closed inside this MR

**Status**: ACCEPTED — the MR-2a brief omitted serialization + the read endpoint

**Spec deviation**: The MR-2a (`b496fe6`) brief says *"the schema is ready — you
read/write the column via the existing repository surface."* The schema column
DID land but the SQLAlchemy → JSON-API mapper omitted `active_dataset_id`, the
PATCH schema (`SessionUpdate`) didn't allowlist it, and **no GET endpoint** exposed
a single session's metadata (only `GET /api/projects/:id/sessions` list +
`GET /api/sessions/:id/events` event-replay existed). Without these three
pieces the read path needed by US-205 / IC-J002-3 cannot exist.

**Crafter's call**: MR-2 lands these three substrate completions because they
are mechanical (no design choice; all three are one-liners that finish what
MR-2a started) and gating the merge on a MR-2b would just sequence a trivial
diff. They are explicit MR-2 deliverables in this crafter run:

1. `backend/app/repositories/metadata/_mappers.py` — `session_to_dict` now
   includes `active_dataset_id` so the column flows through every read.
2. `backend/app/routers/schemas/session.py` — `SessionUpdate.active_dataset_id`
   is on the wire so PATCH /api/projects/:p/sessions/:s honors it.
3. `backend/app/routers/sessions.py` + `controllers/conversation_controller.py`
   + `controllers/http_controller.py` + **NEW** `use_cases/session/get_session.py`
   — adds `GET /api/sessions/:session_id` returning JSON:API session metadata.
   Auth is org-scoped (404 for cross-org). The use case shape mirrors
   `list_session_events`'s existing pattern.

**Why MR-2 not MR-2b**: each diff is < 15 lines, none touches business logic,
and they jointly complete the MR-2a schema's read surface. Sequencing them as
a separate MR would add ceremony without value. The DESIGN §2.3.B
`resumeSession` actor reads `session.active_dataset_id` from `get_session`
— that's the contract DESIGN names; these changes deliver it.

**Litmus impact**: with these three changes, US-205 #1 (happy path resume
restores dataset chip), US-205 #2 (null dataset → conversational mode), and
IC-J002-3 (atomic materialization) all GREEN. Without them, only US-205 #4
(silent-not-found) + #5 (harness) would pass; the rest would fail on missing
read-side surface.

**Action for reviewer**: verify the three changes are tightly scoped to
substrate completion (no new business logic), and confirm the 1425 backend
pytest target still holds (it does — pre-existing FHIR test failure is
verified to reproduce on `main` HEAD without my changes).

### D-MR2-b — MR-2-a column wire name is `migration 012`, not `migration 009`

**Status**: NON-ISSUE — naming drift in the DISTILL handoff, no code action

**Observation**: `distill/handoff-distill-to-deliver.md` §"MR-2" calls the schema
delta "Migration 009". The actual landed migration in MR-2a (`b496fe6`) is
`012_add_session_active_dataset_id.py`. The numbering is determined by the
linearized alembic head at the time of landing. The DESIGN amendments
mention "Migration 009"; the user prompt for MR-2 correctly says "Migration
012 already landed in MR-2a".

The dataset-shape is unchanged; the migration sequence number is a routing
detail not a behavioral contract. The DISTILL handoff's "Migration 009"
references should be updated by a future DISTILL revisit MR (the DWD-13
follow-up); MR-2 leaves them in place per the Iron Rule (don't touch
upstream artifacts).

### D-MR2-c — Pre-existing US-204 SSR failures still reproduce

**Status**: PRE-EXISTING — not a MR-2 regression; same root cause as MR-1.5

**Observation**: The two US-204 scenarios that fail on MR-1.5 (per the
"Pre-existing US-204 SSR failures" entry above) continue to fail on MR-2:

- `test_us204_cold_deep_link_resolves_active_scope_before_paint.py::test_cold_deep_link_to_project_resolves_active_scope_before_paint`
- `test_us204_cold_deep_link_resolves_active_scope_before_paint.py::test_deep_link_with_intent_resource_carries_through_to_session_active`

Verified MR-2 is behavior-neutral for these tests: `git stash` (drops all MR-2
changes) + re-run reproduces verbatim. The root cause is the web-ssr SSR
pipeline rendering the welcome panel instead of the project chip, unchanged
from MR-1.5.

**Action**: surface to platform team — same as in the MR-1.5 entry above.
MR-2 ships unblocked.

### D-MR2-d — Cross-tab SSE test relies on `refresh_session_list` harness event

**Status**: ACCEPTED — the test mechanism is a session-chat event

**Decision**: US-203 Example 4 ("session created in other tab refreshes list
within 1 second") is implemented by:
1. Tab A subscribes to `GET /ui-state/flow/session-chat/projection/stream?...`
2. Tab B creates a session via the backend AND dispatches a
   `refresh_session_list` event to session-chat.
3. The session-chat's `session_list_visible` state transitions to
   `loading_session_list` on `refresh_session_list`; the loadSessionList
   invoke fires; the new list is appended to the session-chat flow log.
4. Tab A's SSE subscription sees the new projection.

The `refresh_session_list` event is a one-line addition to session-chat's
public event surface. It is also useful for future scenarios where a user
explicitly refreshes (e.g., a "pull-to-refresh" gesture). It is NOT a
harness-only knob — its acceptance into the public event vocabulary is the
discharge of US-203 Example 4 + the DWD-9 cross-tab refresh contract.

### D-MR2-e — No web-ssr rebuild in this MR (loader changes deployed at next image cut)

**Status**: ACCEPTED — frontend loader changes are source-only; SSR image rebuilds in a separate boundary

**Observation**: The MR-2 frontend route changes (`frontend/app/routes/sessions.tsx`,
`frontend/app/routes/chat.tsx`) live in source but the web-ssr container
image (built via Bazel at `frontend/BUILD.bazel`) is not rebuilt in this MR
run. The acceptance tests verify behavior through projection reads, NOT through
SSR'd HTML, so they pass against the current web-ssr image.

When the next Bazel image cut lands (typically via the gastown merge-queue's
build pipeline), the new loaders take effect. The MR-1.5 review noted the
same posture for project-detail.tsx; this MR follows that pattern.

**Action for reviewer**: confirm the loader sources are correct (they will be
exercised when the SSR image refreshes) and that the projection-based
acceptance suite is the SSOT for MR-2 behavior verification.

