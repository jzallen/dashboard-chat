# Upstream issues — `frontend-coexistence` DISTILL

> **Wave**: DISTILL
> **Date**: 2026-05-13
> **Companion**: [`roadmap.json`](./roadmap.json), [`wave-decisions.md`](./wave-decisions.md), [`handoff-distill-to-deliver.md`](./handoff-distill-to-deliver.md)
> **Purpose**: surface any DISTILL-wave findings that need DESIGN-level resolution OR represent infrastructure/dependency blockers DELIVER cannot satisfy unilaterally.

## TL;DR

**No HIGH-severity upstream blockers.** The DESIGN wave (and Praxis's system-level review) covered every binding decision DISTILL needed. The work below is **MEDIUM/LOW informational** — pre-existing tactical gaps DELIVER will need to fill at execution time. None of them block writing the acceptance suite; they are surfaced here so DELIVER's first action is informed rather than discovered.

---

## DI-U-1: Slow-upstream induction mechanism for the loader-timeout scenario (MEDIUM)

**Issue**: The `loader-fails-fast-when-auth-proxy-slow.feature` scenarios require a deterministic way to make `auth-proxy` respond slowly (10s) so the test can assert `web-ssr` fails fast (≤ 5s). DESIGN did not specify which mechanism DELIVER should use. Two candidates:

- **Option A — auth-proxy `SLOW_MODE` env toggle.** Cleaner, no compose changes. `auth-proxy` checks `process.env.SLOW_MODE_DELAY_MS` and `setTimeout`s before responding when set. Adds ~20 lines to `auth-proxy/index.ts`. Test enables via compose override (`docker compose -f docker-compose.yml -f docker-compose.slow-test.yml up -d`).
- **Option B — `tc qdisc netem delay` compose-level shim.** Less invasive on auth-proxy source but requires `NET_ADMIN` capability on the auth-proxy container and a script that runs at compose-up. Brittle on macOS hosts where `tc` is Linux-only (e.g., devs on Mac, the test fails outside the local Linux compose).

**Recommendation**: Option A. Simpler, portable across Linux/macOS, easier to reason about under git diff.

**How DELIVER addresses**: Phase 04 (Slice 4 / MR-3) includes the slow-upstream induction wiring. The picked mechanism is documented in `tests/acceptance/frontend-coexistence/README.md`. The scenario un-skipping in Phase 04 is gated on this wiring being in place.

**Blocks**: phase 04 only. Phases 01/02/03 do not depend on this.

**Source**: Praxis review §5 "Loader timeout handling"; DISTILL wave-decisions.md DI-5.

---

## DI-U-2: Auth-proxy test-mirror endpoint for the bearer-forwarding scenario (MEDIUM)

**Issue**: The `loader-forwards-bearer-to-auth-proxy.feature` scenario "A loader-driven request preserves the browser's Authorization header end-to-end" requires an observation point at `auth-proxy` that records the most-recent inbound `Authorization` header value. The acceptance test mints a probe bearer string, makes the SSR'd request, then queries the mirror endpoint to verify the bearer survived the `web-ssr → auth-proxy` hop.

**Three candidates**:

- **Option A — dedicated test-mirror endpoint** (`GET /auth-proxy/test/last-seen-authorization`). Gated by `AUTH_PROXY_TEST_MIRROR_ENABLED=true` env var; returns a 404 unless the env is set. Adds ~30 lines to `auth-proxy/index.ts`. Production-safe (off by default).
- **Option B — auth-proxy access log inspection.** Test grep's the auth-proxy container's stdout via `docker logs dashboard-auth-proxy`. No code change required but log format becomes a load-bearing test contract; any future log-format change breaks the test.
- **Option C — vitest unit test of `uiStateClient(request)` instead of an end-to-end probe.** Reduces the contract to a unit-level mock. Loses the end-to-end coverage (would not catch a regression where Hono strips the header before `createRequestHandler` runs).

**Recommendation**: Option A. Most precise, production-safe, test-format-stable.

**How DELIVER addresses**: Phase 02 (Slice 2 / MR-1) wires the mirror endpoint. The endpoint's path is documented in `tests/acceptance/frontend-coexistence/README.md` as `AUTH_PROXY_TEST_MIRROR_PATH`.

**Blocks**: phase 02 only.

**Source**: DESIGN wave-decisions.md DWD-1; DISTILL test_loader_forwards_bearer_to_auth_proxy.py.

---

## DI-U-3: DOM-fingerprint scenario implementation strategy (LOW)

**Issue**: The `existing-routes-render-identically-through-ssr.feature` scenario "The DOM after hydration is structurally equivalent pre/post MR-0 for the entry routes" is tagged `@needs-playwright`. DISTILL DI-2 deferred the implementation strategy to DELIVER. Three options:

- **Option A — `playwright-python` in the acceptance suite.** Adds ~50 MB dep + browser binary. Most faithful to the original intent (DOM after hydration).
- **Option B — move the scenario to `e2e/`** alongside the existing Playwright suite. Loses the acceptance-suite SSOT grouping but reuses existing harness.
- **Option C — reduce to HTML-shape assertion.** Asserts the SSR'd HTML body's structural shape (length, `<div id="root">` content, `<Scripts>` reference) matches pre/post within tolerance. Lower fidelity but no Playwright dep.

**Recommendation**: Option C for MR-0 acceptance (cheap, fast, sufficient for library-mode parity). Option A or B if a regression turns out to need browser-level fidelity later.

**How DELIVER addresses**: Phase 01 picks one of the three options; the choice is documented in `tests/acceptance/frontend-coexistence/README.md` and the scenario's `@needs-playwright` tag updates accordingly.

**Blocks**: phase 01's `scenarios_deferred_within_phase` list. Doesn't block other scenarios.

**Source**: DISTILL wave-decisions.md DI-2; Praxis review §5 (not directly named, but the DOM-fingerprint intent traces to handoff §3.1).

---

## DI-U-4: ESLint rule `no-loader-with-chat-import` is optional (LOW)

**Issue**: DWD-3 §"How to apply" item 3 names an optional ESLint rule that would flag a `loader` export co-located with a `ChatView` import (the DWD-3 enforcement). DESIGN deferred whether the rule lands. DISTILL wrote a scenario for it (`chat-route-bypasses-ssr-via-clientloader.feature :: Optional ESLint rule flags violations`) that skips when the rule is absent.

**Recommendation**: DELIVER's Phase 03 (Slice 3 / MR-2) decides whether to ship the rule. Cost is low (~20 lines for a custom rule, ~5 lines of eslintrc wiring); benefit is real (prevents accidental DWD-3 violations in future migrations).

**How DELIVER addresses**: Phase 03 decision documented in the MR-2 description. If shipped, the scenario unpends. If not shipped, the scenario remains `@skip` indefinitely.

**Blocks**: nothing — the scenario already skips gracefully.

**Source**: DESIGN wave-decisions.md DWD-3 §"How to apply" item 3.

---

## DI-U-5: Reversibility test refs need pinning at MR-2 merge (LOW)

**Issue**: The `route-reverts-to-library-mode-when-loader-removed.feature` scenarios "The route COMPONENT file is byte-unchanged across migrate-then-revert" and "The forward and reverse diffs are mirror images" reference three git refs:

- `PRE_SLICE_2_REF` — the commit before Slice-2 added the loader.
- `POST_SLICE_2_REF` — the Slice-2 merge commit (loader exists).
- `POST_MR_2_REF` — the MR-2 merge commit (loader removed).

These are environment variables the test reads at run time. They must be pinned (e.g., in `tests/acceptance/frontend-coexistence/README.md` or a small `refs.json` artifact under `deliver/`) when MR-2 lands, so the tests are reproducible across future runs.

**How DELIVER addresses**: Phase 03 records the three refs in `docs/feature/frontend-coexistence/deliver/roadmap-execution-notes.md` (or equivalent) at MR-2 merge time. The acceptance suite's README documents how the tests resolve these refs from env or from a recorded artifact.

**Blocks**: phase 03's reversibility scenarios only.

**Source**: DISTILL test_route_reverts_to_library_mode_when_loader_removed.py.

---

## DI-U-6: `MIGRATED_ROUTE_PATH` parameterization across phases (LOW — coordination)

**Issue**: Phase 02 picks one route to migrate first (DESIGN suggested `/login`; DELIVER may pick differently based on product priority). Phases 02, 03, and 04 all reference that route via the `MIGRATED_ROUTE_PATH` env var. The route choice must be coherent across the three phases.

**How DELIVER addresses**: Phase 02's MR-1 description names the picked route explicitly. `tests/acceptance/frontend-coexistence/README.md` documents the `MIGRATED_ROUTE_PATH` env var with a default (`/login`) and a pointer to where to override.

**Blocks**: nothing — the default works if `/login` is the picked route; the env var provides escape hatch otherwise.

**Source**: DESIGN application-architecture.md §2 (migration playbook — worked example uses /login); DISTILL roadmap.json phase 02 scope.

---

## DI-U-7: F-4 RAM baseline measurement (LOW — informational)

**Issue**: Praxis review F-4 flagged that ADR-031's ~150 MB Node-tier RAM estimate may be optimistic for the SSR bundle. DESIGN deferred measurement to DELIVER. DISTILL did NOT write an acceptance scenario for this (it's a measurement, not a contract); the finding is informational and lands in DELIVER's Phase 04 baseline-metrics.md artifact (alongside the auth-proxy QPS baseline).

**How DELIVER addresses**: Phase 04's `baseline-metrics.md` records the measured `web-ssr` container RAM footprint at steady state. If it exceeds 150 MB, the finding is noted and CLAUDE.md's frontend architecture block is updated.

**Blocks**: nothing.

**Source**: Praxis review §3 F-4; DESIGN review-by-system-designer.md §7 (deferred to DELIVER).

---

## Issues NOT promoted to upstream blockers

These items came up during DISTILL but resolved internally without needing DESIGN's attention:

- **Test framework choice (TS Cucumber vs pytest)**: resolved in DI-2 (pytest, mirroring `tests/acceptance/ibis-as-only-sql-compiler/`). No upstream input needed.
- **Walking-skeleton strategy (A/B/C/D)**: resolved in DI-1 (Strategy C). No upstream input needed.
- **Carpaccio slice count**: resolved in DI-3 (4 slices). No upstream input needed.
- **Whether to use pytest-bdd**: resolved in DI-2 (no — matches `ibis-as-only-sql-compiler` precedent). No upstream input needed.
- **DOM-fingerprint scenario destination**: deferred to DELIVER (DI-U-3 above) but flagged as LOW because the scenario can run in any of three forms and all three are valid.

## Cross-references

- DESIGN wave-decisions: [`../design/wave-decisions.md`](../design/wave-decisions.md) — DWD-1..DWD-8 (immutable; DISTILL did not contradict any).
- DESIGN review (Praxis): [`../design/review-by-system-designer.md`](../design/review-by-system-designer.md) — §7 resolution log shows which findings DESIGN resolved inline vs deferred to DISTILL/DELIVER.
- DISTILL wave-decisions: [`./wave-decisions.md`](./wave-decisions.md) — DI-1..DI-8 (the strategy choices this wave makes).
- DELIVER roadmap: [`./roadmap.json`](./roadmap.json) — four phases; each phase names the issues from this file it must resolve.
