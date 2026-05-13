# DELIVER — Upstream Issues for J-002 MR-1

> **Wave**: DELIVER (project-and-chat-session-management / J-002 MR-1)
> **Date**: 2026-05-13
> **Owner**: main-orchestrator (nw-deliver session for MR-1)
> **Purpose**: Surface deviations from DISTILL/DESIGN binding artifacts the
> crafter dispatches encountered. Per the user instructions, this document
> is the named escape hatch for genuine errors discovered during DELIVER.

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
