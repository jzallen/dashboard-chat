# DISTILL Wave Decisions — session-onboarding `/event`-to-`/begin` parity slice

**Wave:** DISTILL (brownfield delta) · **Date:** 2026-05-24 · **Author:** Quinn (nw-acceptance-designer)
**Binding source:** `docs/feature/session-onboarding/design/event-slice-scope.md` (RATIFIED 2026-05-24)
**Extends:** `event-model.md` (Specs 4/5; addendum — no new domain events), `wave-decisions.md` §9 (D-E1/D-E2/D-E3)
**Entry mode:** DESIGN-entry brownfield (no `discuss/` — ACs derived from DESIGN, story traceability N/A).

This records the DISTILL-wave decisions for turning the ratified `/event` parity seeds
into executable acceptance tests + `roadmap.json`. It does NOT restate the DESIGN log; it
references it and records only what DISTILL decided.

---

## DWD-1 — Test strategy: in-process Hono app via `app.fetch` + injected mock `fetch`

The acceptance tests drive the in-process Hono app (`buildSessionOnboardingApp`) via
`app.fetch(new Request(...))` — no live socket, no compose stack — and inject a mock `fetch`
(`makeMockFetch`) as the single I/O port at the WorkOS / backend driven-port boundary. This
is the existing `ui-state/index.test.ts` pattern, extended in place. It is the **Strategy B
equivalent**: the local transport (the ACL router + orchestrator + machine) is REAL and
in-process; only the costly external dependency (WorkOS `/oauth/userinfo`, backend
`/api/orgs`) is faked.

The driving port for every parity scenario is `POST /flow/session-onboarding/event` (the ACL
router). Assertions are at the projection / HTTP-status boundary (`GET .../projection` or the
`/event` response body). No internal component is invoked directly (Mandate 1).

**Stack adaptation:** this is TypeScript + vitest + Hono, NOT pytest-bdd. No `.feature` files,
no step definitions, no Python scaffolds, no `conftest.py` — those are wrong for this stack.
Tests are vitest `describe`/`it` matching the existing Spec style, phrased as user/system
behavior (e.g. "refuses an event with no flow id"), not code design.

## DWD-2 — RED convention for DELIVER: `it.skip` with a leading reason comment

There was no skip convention in `index.test.ts`. DISTILL establishes: behavior-change slices
are marked `it.skip(...)` with a leading `// RED until DELIVER Slice N — <behavior>` comment,
encoding the **post-implementation TARGET** assertion (not the current behavior). The suite
stays green; DELIVER un-skips one at a time (Outside-In: un-skip → watch RED → implement
minimum → GREEN). Iron Rule: a skipped spec is implemented to green, never weakened to pass.

- **RED (skipped):** Slice 4 (×1), Slice 5 (×2), Slice 6 well-formedness (×1) = 4 skipped.
- **GREEN (characterization):** Slices 1-3 + the Slice 6 domain-rule contrast.

## DWD-3 — Mandate 7 (RED scaffolding) is N/A — all modules already exist

The reference methodology expects RED tests to fail on a missing module (`__SCAFFOLD__` /
ImportError). That convention does NOT apply here: every production module already exists
(`router.ts`, `machine.ts`, `setup/domain.ts`). The RED tests go RED because the
**validation behavior is unwritten**, not because of an import error. There is nothing to
scaffold.

## DWD-4 — Characterization-first ordering per the Iron Rule (brownfield walking skeleton)

Slices 1-3 are CHARACTERIZATION written GREEN against current code — they pin
currently-untested observable behavior of the existing `/event` handler so Slices 4-6 can
edit it safely. This is the brownfield analog of the walking skeleton (CLAUDE.md Iron Rule):
land the pins before any handler edit.

- **Slice 1** pins the existing 400-on-missing-`flow_id`/`type` contract (untested at the HTTP
  layer until now). It pins the OBSERVABLE 400 (status + error present), deliberately NOT the
  exact error string, so the DELIVER zod-DTO refactor may upgrade the body to carry `issues`
  without breaking the pin.
- **Slice 2** pins `retry_clicked` over the `/event` transport (previously only covered at the
  machine + orchestrator levels).
- **Slice 3** pins both arms of the `__force_failure__` failure-simulation gate over `/event`
  (previously zero HTTP-layer coverage).

## DWD-5 — Failure-simulation gate is enabled in-test via `probe()`; reset in `afterEach`

The `__force_failure__` and `force_reissue_failures` harness side-channels are gated by
`@dashboard-chat/shared-failure-simulation` `shouldInject`, which reads a **module-scoped
verdict cache** populated by `probe(env, service)` — it does not re-parse env per request. So:

- **Enable:** `probe({ ENVIRONMENT: "ci", FAILURE_SIMULATION_ENABLED: "true" }, "ui-state")`
  (the `enableFailureSimulation()` helper) → gate open.
- **Disable (production default):** `probe({}, "ui-state")` (the `disableFailureSimulation()`
  helper) → fail-closed verdict. This is also the default when `probe()` was never called, so
  the Slice-3 OFF arm needs NO setup.

Because the cache is process-global, the file-level `afterEach` ALWAYS restores the disabled
default so an enabled scenario cannot leak the open verdict into the next. Verified: the full
`ui-state` suite (11 files, 152 pass / 4 skip) shows no cross-file leakage — Vitest's per-file
worker isolation plus the `afterEach` reset hold the invariant.

> Surprise worth recording: `buildSessionOnboardingApp` does NOT call `probe()` at
> composition time, so without an explicit `probe()` the gate is the fail-closed default
> regardless of the `ENVIRONMENT: "dev"` pin in `vitest.config.ts` (that env only matters when
> `probe()` actually reads it). The Slice-3 ON arm therefore MUST call `enableFailureSimulation()`
> itself; relying on the vitest-config env alone would silently leave the gate closed.

## DWD-6 — Honor the inherited DESIGN decisions (reference, do not re-open)

DISTILL confirms zero contradictions against the ratified DESIGN decisions and honors them:

- **OQ-E1 = ENFORCE (403)** — Slice 5 rejects a mismatched body `flow_id` with 403. The
  FE/harness `X-User-Id` audit is a work item INSIDE Slice 5 (the suite fails loudly on any
  `/event` client that omits the header).
- **OQ-E2 = FUNCTION** — Slice 5 adds a typed ACL `translateWireEvent` function, not a command
  class.
- **OQ-E3 = INCREMENTAL** — per-event DTO validation lands across Slices 1/4/6, not one union
  up front.
- **D-E1 = anemic-but-correct** — all translation lives in `router.ts`; the ONLY domain touch
  in the whole slice is export-widening `isUnderlyingCauseTag` (D-E2). The empty-string org-name
  rule STAYS on `constructOrgName` — Slice 6 explicitly contrasts ACL well-formedness (absent
  `org_name` → 400) against the domain rule (empty `org_name` → 200 + validation error) to
  prove the rule was NOT promoted to the boundary.

(See `event-slice-scope.md` §3/§6 and `wave-decisions.md` §9 for the full rationale.)

## DWD-7 — Translation must stay in `router.ts`, never the shared orchestrator

ADR-028 "no machine knows another": the orchestrator's `send` (`orchestrator.ts:746`) is
machine-agnostic and spreads the raw payload for ALL machines. DELIVER must put every
payload/identity translation in the session-onboarding `router.ts`. The acceptance tests
assert only at the HTTP/projection boundary, so they don't dictate placement — but a fix that
leaked session-onboarding vocabulary into the generic `send` path would break sibling-machine
suites (the RG-EVENT gate's full-suite run catches that).

## DWD-8 — Observable-truth correction for Slice 2 (Iron Rule)

The Slice 2 seed asserts the projection transitions `error_recoverable → … → error_terminal`
and `retry_budget_used_count == 3`. Empirically, NEITHER is observable at the projection
boundary: the projection fold has no `error_terminal` reducer and no terminal event is emitted
when the actor escalates, and `retry_budget_used_count` is actor-internal (absent from the
projected context). Per the Iron Rule, the characterization pins what the user ACTUALLY
observes — each `retry_clicked` over `/event` is accepted (200) and the flow REMAINS on the
recoverable-error screen. This is logged as observability gap **U-E1** in
`distill/upstream-issues.md`; it is a gap, not a contradiction, and does not block the slice.

---

## Definition-of-Done snapshot (DISTILL → DELIVER)

- [x] All parity scenarios written; Slices 1-3 + Slice-6-contrast GREEN, Slices 4-6 RED (`it.skip`).
- [x] Test pyramid: acceptance at the `/event` driving port; machine/orchestrator unit coverage already exists; DELIVER adds the inner-loop unit tests for the ACL helpers.
- [x] Error-path ratio ~64% (9/14 parity scenarios) — exceeds the 40% mandate.
- [x] Business-language describe/it (no XState/zod/internal type names leak into the strings).
- [x] First-scenario executable + the whole suite green/skip: `cd ui-state && npx vitest run` → 152 pass / 4 skip; eslint 0 errors.
- [ ] Peer review (critique-dimensions) — to run at `*handoff-develop`.
- [ ] CI/CD — ui-state vitest is unaffected by the `--auto` selector (docs/code split); the RG-EVENT gate runs it per slice.
