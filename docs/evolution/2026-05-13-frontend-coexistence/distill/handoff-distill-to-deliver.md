# DISTILL → DELIVER Handoff — `frontend-coexistence`

> **Wave**: DISTILL → DELIVER
> **Date**: 2026-05-13
> **From**: nw-acceptance-designer (DISTILL wave)
> **To**: nw-software-crafter (DELIVER wave)
> **Status**: DISTILL artifacts committed; acceptance suite scaffolded with all scenarios `@skip` per DI-8.
> **Companion**: [`roadmap.json`](./roadmap.json) (DELIVER's primary input), [`wave-decisions.md`](./wave-decisions.md), [`upstream-issues.md`](./upstream-issues.md)

---

## TL;DR

DISTILL formalized the 8 BDD scenario groups from DESIGN's handoff plus the 3 Praxis additions into **10 behavior-first Gherkin `.feature` files** and **10 mirroring `pytest` test modules**. Every scenario is marked `pytest.mark.skip(...)` with a named reason pointing at `roadmap.json`. DELIVER unpends scenarios one phase at a time per the 4-phase plan in `roadmap.json`.

The acceptance suite uses **pytest + httpx + subprocess** (no pytest-bdd, no Playwright at MR-0; see DI-2). The walking-skeleton strategy is **C — real local + skip-when-unavailable** (see DI-1). The Carpaccio slicing is **4 slices** mapping to 4 DELIVER MRs (see DI-3).

**No HIGH-severity upstream blockers.** Seven MEDIUM/LOW informational findings in `upstream-issues.md` flag DELIVER-time tactical choices (slow-upstream induction, test-mirror endpoint, DOM-fingerprint implementation, etc.).

---

## 1. Artifacts produced (this wave)

```
docs/feature/frontend-coexistence/distill/
├── wave-decisions.md                                        # DI-1..DI-8 (binding strategy choices)
├── roadmap.json                                             # 4 phases; DELIVER's primary input
├── upstream-issues.md                                       # 7 MEDIUM/LOW findings, 0 HIGH blockers
├── handoff-distill-to-deliver.md                            # this file
├── rrv7-handler-renders-existing-routes.feature             # walking skeleton (1 scenario)
├── existing-routes-render-identically-through-ssr.feature   # §3.1 + §3.5 + §3.7 (8 scenarios)
├── compose-topology-gains-one-service.feature               # §3.8 (2 scenarios)
├── migrated-route-renders-html-server-side.feature          # §3.2 (5 scenarios)
├── route-reverts-to-library-mode-when-loader-removed.feature # §3.3 (4 scenarios)
├── chat-route-bypasses-ssr-via-clientloader.feature         # §3.4 (5 scenarios — 1 skips when ESLint rule absent)
├── loader-forwards-bearer-to-auth-proxy.feature             # §3.6 DWD-1 (5 scenarios)
├── loader-fails-fast-when-auth-proxy-slow.feature           # Praxis §5 loader timeout (2 scenarios)
├── ssr-instances-produce-identical-html.feature             # Praxis §5 horizontal scale (2 scenarios)
└── loader-fanout-to-auth-proxy-stays-bounded.feature        # Praxis F-2 fan-out (2 scenarios)

tests/acceptance/frontend-coexistence/
├── README.md                                                # how to run the suite
├── pyproject.toml                                           # pytest + httpx + pyyaml; standalone venv
├── conftest.py                                              # fixtures (driver, reachability, repo state)
├── driver.py                                                # HTTP probe + file inspection + compose helpers
├── test_rrv7_handler_renders_existing_routes.py             # 1 test
├── test_existing_routes_render_identically_through_ssr.py   # 8 tests
├── test_compose_topology_gains_one_service.py               # 3 tests
├── test_migrated_route_renders_html_server_side.py          # 5 tests
├── test_route_reverts_to_library_mode_when_loader_removed.py # 4 tests
├── test_chat_route_bypasses_ssr_via_clientloader.py         # 5 tests
├── test_loader_forwards_bearer_to_auth_proxy.py             # 5 tests
├── test_loader_fails_fast_when_auth_proxy_slow.py           # 2 tests
├── test_ssr_instances_produce_identical_html.py             # 2 tests
└── test_loader_fanout_to_auth_proxy_stays_bounded.py        # 2 tests
```

**Scenario totals**: 36 scenarios across 10 .feature files = 37 pytest test functions (one .feature scenario maps to multiple test functions in some cases for assertion-level granularity).

**Skip state at handoff**: 100% — every test is `pytest.mark.skip(reason=...)`. The walking-skeleton test is the FIRST one DELIVER unpends.

---

## 2. The 4 phases — what DELIVER does, in order

See `roadmap.json` for the binding spec. Quick navigation:

### Phase 01 — Slice 1 / MR-0 (size: L)

**Scope**: RRv7 framework-mode plumbing. ONE atomic merge per ADR-034. New files (`root.tsx`, `routes.ts`, `ssr.ts`, `ui-state-client.ts`), `git mv` 5 files from `ui-presentation/` to `frontend/app/routes/`, DELETE `App.tsx`, REWRITE `main.tsx`, modify `vite.config.ts` (add `reactRouter()`, REMOVE `@vitejs/plugin-react` — load-bearing), modify `tsconfig.json`, `AppShell/index.tsx`. DELETE `ui-presentation/`. Update root `package.json` workspaces. System-level: `frontend/BUILD.bazel` second `oci_image`, `frontend/nginx.conf` catch-all rule, `docker-compose.yml` `web-ssr:` block.

**Unpends**: 11 scenarios (walking-skeleton + 8 in existing-routes-render-identically-through-ssr.feature + 2 in compose-topology-gains-one-service.feature).

**Deferred within phase**: DOM-fingerprint scenario (decision: playwright-python vs e2e/ vs HTML-shape; see DI-U-3).

### Phase 02 — Slice 2 / MR-1 (size: M)

**Scope**: first per-route migration (likely `/login`; DELIVER picks). Add a `loader` that prefetches via `uiStateClient(request)`. Wrap in `<HydrationBoundary>`. Remove the AppShell inner `<QueryProvider>` wrap per DWD-7. Wire the auth-proxy test-mirror endpoint per DI-U-2.

**Unpends**: 11 scenarios (migrated-route-renders-html-server-side.feature + loader-forwards-bearer-to-auth-proxy.feature).

### Phase 03 — Slice 3 / MR-2 (size: M)

**Scope**: (a) Revert Slice-2 migrated route to library-mode (remove the `loader` export — symmetric mirror diff). (b) Migrate one chat-bearing route family with `clientLoader`-only (DWD-3). Record git refs for the reversibility tests per DI-U-5.

**Unpends**: 8 scenarios (route-reverts-to-library-mode-when-loader-removed.feature + chat-route-bypasses-ssr-via-clientloader.feature).

**Deferred within phase**: optional ESLint rule scenario (DI-U-4).

### Phase 04 — Slice 4 / MR-3 (size: M)

**Scope**: operational readiness — loader timeout configuration, horizontal-scale validation under `--scale web-ssr=2`, auth-proxy fan-out bound measurement with recorded baseline.

**Unpends**: 6 scenarios (loader-fails-fast-when-auth-proxy-slow.feature + ssr-instances-produce-identical-html.feature + loader-fanout-to-auth-proxy-stays-bounded.feature).

---

## 3. How DELIVER picks up

```bash
# 1. Pull the DISTILL artifacts (they are on main once this DISTILL MR merges).
git checkout main && git pull

# 2. Read the DISTILL outputs in this order:
#    a) roadmap.json — the 4-phase plan
#    b) wave-decisions.md — DI-1..DI-8
#    c) upstream-issues.md — 7 informational findings
#    d) the .feature files for the phase being delivered
#
# 3. Create the feature branch for the FIRST phase:
git checkout -b deliver/frontend-coexistence-mr-0

# 4. Bring the local compose stack up (Strategy-C precondition):
docker compose up -d

# 5. Verify the acceptance suite collects + skips cleanly:
cd tests/acceptance/frontend-coexistence
uv sync
uv run --no-project pytest --collect-only   # should report 37 tests, all skipped
uv run --no-project pytest                  # 37 skipped, 0 failed, 0 errored

# 6. For Phase 01: open test_rrv7_handler_renders_existing_routes.py and remove
#    the pytest.mark.skip from pytestmark. Run that one test — it should fail
#    RED (web-ssr container does not exist yet). Outside-In TDD: drive a unit
#    test from the smallest failing step, then drive the implementation.

# 7. When Phase 01's full scenario list is GREEN, submit the MR:
cd /home/node/gt/dashboard_chat
gt mq submit --branch deliver/frontend-coexistence-mr-0
```

---

## 4. Coordination notes for DELIVER

- **Iron Rule**: NEVER modify a failing test to make it pass. After 3 failed attempts on a step, revert and escalate via clear failure output. See CLAUDE.md `tdd` skill mandate.
- **Trunk-based**: every MR lands via `gt mq submit` from `~/gt/dashboard_chat`. DO NOT use `gh pr create`.
- **The `--auto` gate's behavior**: for production-code changes, falls through to `--backend` (ruff + pytest in `backend/`). For docs-only changes, instant-merges. The acceptance suite at `tests/acceptance/frontend-coexistence/` is NOT collected by either path; DELIVER runs it locally before submitting.
- **Iron Rule helper — skip removal**: removing `pytest.mark.skip` from a test takes the test from "skipped" to "running". If it then fails, that's RED (correct DELIVER starting state). It MUST NEVER be re-added to make the test pass. Add it back ONLY if (a) the scenario is genuinely deferred to a later phase, AND (b) the deferral is documented in `roadmap.json` `scenarios_deferred_within_phase`.
- **Phase boundaries are atomic**: each phase ships as one MR. Splitting a phase across MRs is fine for engineering velocity (e.g., land the auth-proxy test-mirror endpoint as a tiny MR-1a, then the route migration as MR-1b) — but the `scenarios_to_unskip` from `roadmap.json` lists what MUST be GREEN by the END of the phase.
- **DESIGN artifacts are read-only**: if DELIVER discovers a DESIGN-level contradiction, append a finding to `docs/feature/frontend-coexistence/deliver/upstream-issues.md` (a new file, not this one); do NOT modify DESIGN's `.md` files. The DESIGN wave-decisions.md DWDs are immutable.

---

## 5. The "doneness" criterion

The feature is DONE when all four phases are GREEN, `tests/acceptance/frontend-coexistence/` has zero remaining `@skip` markers (except for genuinely-deferred-by-roadmap scenarios with named reasons), and the local compose stack post-Slice-4 satisfies all Praxis-encoded operational invariants.

At that point `/nw-finalize` archives the feature to `docs/evolution/`. DELIVER does NOT need to invoke nw-mutation-test for this feature (acceptance suite is integration-level; mutation testing on integration-level fixtures has marginal value).

---

## 6. Cross-references

- DESIGN handoff (the input this DISTILL consumed): [`../design/handoff-design-to-distill.md`](../design/handoff-design-to-distill.md)
- DESIGN wave-decisions (binding contracts): [`../design/wave-decisions.md`](../design/wave-decisions.md) (DWD-1..DWD-8)
- DESIGN application architecture: [`../design/application-architecture.md`](../design/application-architecture.md)
- DESIGN system review (Praxis): [`../design/review-by-system-designer.md`](../design/review-by-system-designer.md)
- ADR-034 (canonical): `docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md`
- This wave's roadmap: [`./roadmap.json`](./roadmap.json)
- This wave's strategy decisions: [`./wave-decisions.md`](./wave-decisions.md)
- This wave's upstream issues: [`./upstream-issues.md`](./upstream-issues.md)
