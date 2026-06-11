# CDO-S4 — DELIVER wave notes

## DES execution log (appended to the shared `../execution-log.json`)
Steps `04-01`, `04-02`, `04-03` — each five phases recorded via `des.cli.log_phase` against the deliver root.
`RED_ACCEPTANCE` is `SKIPPED` per step (the HTTP acceptance suite is an out-of-process port test run by the
orchestrator at the post-merge gate, not by the crafter):
- 04-01 RED_ACCEPTANCE → `CHECKPOINT_PENDING: cdo_s4 real-stack acceptance (test_mode_discovery.py) run by orchestrator post-merge gate`
- 04-02 RED_ACCEPTANCE → `CHECKPOINT_PENDING: cdo_s4 real-stack acceptance (test_reissue_sets_cookie.py) run by orchestrator post-merge gate`
- 04-03 RED_ACCEPTANCE → `NOT_APPLICABLE: KPI emission is stdout observability; no HTTP acceptance scenario — app.test.ts is the verifier`

PREPARE / RED_UNIT / GREEN / COMMIT are `EXECUTED/PASS` for all three steps. (04-03 had a recording-format
correction: the crafter's first RED_UNIT/GREEN entries used a descriptive `--data` string that the stop-hook
validator rejects; corrected via append — last-event-per-phase wins — so the live log resolves clean.)

## Decisions & rationale specific to this slice
1. **Crafter paradigm.** The project CLAUDE.md declares no `## Development Paradigm`, so the orchestration default
   `nw-software-crafter` (OOP) was selected. auth-proxy is functional TypeScript (Hono, module-scoped functions);
   the crafter wrote idiomatic functional TS matching the file — no classes/XState were forced.
2. **`tsc` is not the gate.** The project's bare `npx tsc --noEmit` is not clean over auth-proxy test files at
   baseline (es2022 `.at()` lib mismatch, stale `jose` `KeyLike`, the pre-existing `duplex` `@ts-expect-error`
   directives at app.ts 930/959). Confirmed pre-existing against `e8d6014c`. The operative GREEN gate is vitest;
   CDO-S4 added no new type errors.
3. **Mode-agnostic reissue (HIGH risk note).** The DISTILL CDO-S4 entry flags that gating the cookie emission on
   `AUTH_MODE != dev` would break the dev acceptance assertion. Honored: emission is path/method/status +
   `isUserToken` gated only; `Secure` is the sole dev-gated attribute. `test_reissue_sets_cookie.py` passing on the
   dev stack proves it.
4. **`Headers.append` for never-collapsed cookies (UC-6).** `applyOrgCreateReissue` builds a raw WHATWG `Headers`
   (via `stripReissueHeaders(new Headers(src))`); `Headers.append('Set-Cookie', ...)` is the equivalent of the
   callback's Hono `c.header(..., { append: true })` and preserves the two cookies as distinct headers. Unit case
   (c) asserts `getSetCookie().length >= 2`.
5. **KPI cleanup is a deletion step.** `auth_retry_clicked` was retired upstream (CDO-S3 closed union), so removing
   its trigger + the obsolete test is a sanctioned removal (the subject no longer exists), not Iron-Rule test
   silencing. The orphaned `peekInboundEventType` helper + parameter + call site were removed for hygiene; the two
   `/state`-projection emitters stay.

## Phases run / skipped (orchestrator, standard rigor)
- Phase 1 (roadmap): authored `cdo-s4/roadmap.json` (orchestrator, full contract context) + roadmap-only integrity
  verify (exit 0; the "no log entries yet" notes were the expected pre-execution state).
- Phase 2 (execute): 3 steps via DES-monitored crafter Tasks, sequential, each COMMIT/PASS.
- Phase 3.5 (post-merge integration gate): real dev compose stack; cdo_s4 GREEN; full suite 13/1 (the 1 = pre-existing
  UPSTREAM-S3-1); auth-proxy vitest 252-passed (mandatory pre-merge).
- Phase 3 (L1-L4 refactor): not separately run — the additive route + the two-line cookie append + the deletion are
  already minimal and idiomatic; no duplication/complexity to reduce. (standard rigor, small surface).
- Phase 4 (adversarial review): the crafter-reviewer cross-check is folded into the orchestrator's per-step diff +
  design-compliance verification (no new files, scope held, wiring confirmed via app.fetch boundary tests).
- Phase 5 (mutation): SKIPPED — no per-feature mutation tooling configured for auth-proxy (no `## Mutation Testing
  Strategy` in CLAUDE.md → default per-feature, but no stryker harness exists for this package); the vitest suite's
  falsifiable RED_UNIT cases (asserted RED before GREEN per step) are the kill-rate proxy for this small surface.
- Phase 6 (integrity verify): see execution-log; all 04-* steps have the five phases.
- Phase 7 (finalize): consolidated under `cdo-s4/`. NOT archived to `docs/evolution/` — the feature is incomplete
  (CDO-S5 remains).

## Handoff to CDO-S5
- `GET /api/auth/config` is live for `login.tsx` mode-discovery consumption (no affordance until mode known; dev
  button only when `mode=dev`).
- The org-create reissue now rides `Set-Cookie` — CDO-S5's workos interception path benefits with zero client token code.
- OBS-1: when the `auth.reissue.emitted` observability event is built (ADR-048 §5), set `transport: "both"`.
- UPSTREAM-S3-1 (backend `AuthorizationError→500`) still owed by a backend slice.
