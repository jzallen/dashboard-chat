# DISTILL Wave Decisions — `frontend-coexistence`

> **Wave**: DISTILL
> **Date**: 2026-05-13
> **Inputs**: [`../design/handoff-design-to-distill.md`](../design/handoff-design-to-distill.md), [`../design/wave-decisions.md`](../design/wave-decisions.md) (DWD-1..DWD-8 binding), [`../design/application-architecture.md`](../design/application-architecture.md), [`../design/c4-diagrams.md`](../design/c4-diagrams.md), [`../design/review-by-system-designer.md`](../design/review-by-system-designer.md) (Praxis PASS + 3 additions)
> **Driving ADRs**: ADR-034 (canonical), ADR-033 (layer separation), ADR-031 §2 + §7 (inherited), ADR-015 (preserved), ADR-029 (`active_scope` contract), ADR-028 (XState v5).

This file records the **binding strategy choices DISTILL makes** that DESIGN did not specify. Each entry has a stable identifier (DI-N for "DistIll-N") so DELIVER can cite it. The eight DESIGN-wave decisions (DWD-1..DWD-8) remain immutable; this wave does not re-litigate any of them.

---

## DI-1: Walking-skeleton strategy — **Strategy C (real local + skip-when-unavailable)**

**Decision**: The acceptance suite runs against the **real local compose stack** (`docker compose up` brings up the post-MR-0 topology: `reverse-proxy` + `web-ssr` + `auth-proxy` + `agent` + `ui-state` + `api` + `redis`). When the stack is not reachable, fixtures `pytest.skip()` with a named reason instead of failing. No mocked services. No fake auth-proxy. No InMemory doubles.

**Rationale** (vs Strategies A/B/D):

- **Strategy A (full InMemory)**: rejected. The entire feature is about *topology* — the +1 compose service (`web-ssr`), the nginx routing rule swap, the SSR'd-HTML response shape. InMemory doubles cannot model nginx rule precedence, container startup ordering, the loader→auth-proxy fetch contract, or the SSR boundary. The acceptance contract IS the integration.
- **Strategy B (real local + fake costly externals)**: not applicable. There are no costly externals in this feature — no LLM calls, no paid APIs, no rate-limited services. `auth-proxy`, `ui-state`, `agent`, `api` all run locally for free.
- **Strategy C (real local + skip-when-unavailable)**: **chosen.** Tests probe the real compose stack via `http://localhost:5173` (reverse-proxy host port) and `http://localhost:1042` (auth-proxy host port — the convention `tests/acceptance/user-flow-state-machines/` already uses). When `_service_reachable("http://localhost:5173")` returns false, the suite-level `requires_compose_stack` fixture calls `pytest.skip("compose stack not reachable")` and the suite exits cleanly. Mirrors the proven pattern in `tests/acceptance/ibis-as-only-sql-compiler/conftest.py`.
- **Strategy D (configurable)**: rejected. The feature has no meaningful behavior in an InMemory variant — every scenario is about real HTTP/file/compose behavior. A configurable switch would add complexity for zero benefit.

**How to apply**:

- `conftest.py` defines a session-scoped `requires_compose_stack` fixture that probes `reverse-proxy` and `auth-proxy` health endpoints; failing reachability calls `pytest.skip()`.
- Every test module declares `pytestmark = [pytest.mark.real_io, pytest.mark.<group>]`.
- Tests that read repo file state (e.g., "App.tsx does not exist") do not depend on the compose stack and skip only their own scenarios when the post-MR-0 state isn't on disk yet.

**Source**: nw-distill SKILL.md "Walking Skeleton Strategy Decision", brief §"Wave-specific (DISTILL)" recommendation, comparison with `tests/acceptance/ibis-as-only-sql-compiler/conftest.py:25-79`.

---

## DI-2: Test framework — **pytest + httpx + subprocess (no pytest-bdd, no Playwright at MR-0)**

**Decision**: The acceptance suite is **Python pytest** with `httpx` for HTTP probes, `subprocess` for `docker compose config --services` and grep-style file inspections, and `pathlib` for file-presence assertions. Gherkin `.feature` files live under `docs/feature/frontend-coexistence/distill/` as the **canonical scenario SSOT** (matches the `tests/acceptance/ibis-as-only-sql-compiler/` pattern); `test_*.py` files map 1:1 to scenarios via test-function names and `pytest.mark` tags. **No pytest-bdd dependency.** The one DOM-fingerprint scenario (§3.1 visual parity post-hydration) lands as a pytest test with **Playwright invocation deferred to DELIVER** — at DISTILL it is marked `@skip(reason="needs-playwright; DELIVER may add playwright-python or move to e2e/")` with a pointer to the DELIVER roadmap step that decides the implementation strategy.

**Rationale** (vs the alternatives the brief named):

- **Cucumber + Playwright (TS)**: rejected for this suite. The only existing TS acceptance suite (`tests/acceptance/user-flow-state-machines/`) is the *anomaly* — every other suite in `tests/acceptance/` is pytest. The `--auto` refinery gate's fall-through is `--backend` (`cd backend && pytest`), which won't collect either language's suite — so neither choice is gate-coupled. Defaulting to pytest aligns with the majority pattern, the project's `tdd` skill convention, and the `--acceptance=<feature>` selector (`uv run --no-project pytest`).
- **vitest + Playwright**: would force the suite into the `frontend/` workspace turbo graph, conflicting with the per-feature pyproject.toml convention CLAUDE.md states ("Each suite lives at `tests/acceptance/<feature>/` with its own `pyproject.toml` + venv").
- **pytest-bdd**: rejected. Adds a dependency, doubles the maintenance surface (each step phrase becomes a step-glue function), and provides no observable benefit over `test_*` function names that match scenario titles. The `ibis-as-only-sql-compiler` precedent intentionally skipped pytest-bdd; we follow.

**Why most scenarios don't need Playwright** (mapping `.feature` file → driving mechanism):

- `existing-routes-render-identically-through-ssr.feature` — HTTP probes + file-system inspection. The DOM-fingerprint scenario is the one DOM-touching scenario; it is operationalized as HTML-shape assertions on the SSR response body or deferred to DELIVER per DI-U-3. For MR-0 (every route library-mode, no loader), the SSR response is structurally identical to today's nginx `try_files`-served `index.html` shell.
- `compose-topology-gains-one-service.feature` — `docker compose config --services` subprocess.
- `migrated-route-renders-html-server-side.feature` — HTTP probe + HTML body inspection (regex/structural).
- `route-reverts-to-library-mode-when-loader-removed.feature` — HTTP probe + HTML body inspection + `git diff` subprocess for the mirror-image assertion.
- `chat-route-bypasses-ssr-via-clientloader.feature` — file-system inspection of `frontend/app/routes/*.tsx` (no `loader` export co-located with `ChatView` import) + HTTP probe of `/api/channels/<id>/presentation-state` to confirm nginx routes it to `agent`.
- `loader-forwards-bearer-to-auth-proxy.feature` — HTTP probe + auth-proxy test-mirror endpoint (DI-U-2; a loader test fixture sends `Authorization: Bearer <probe>` and verifies the upstream `auth-proxy` saw the same value).
- `loader-fails-fast-when-auth-proxy-slow.feature` — HTTP probe with a wall-clock timer + slow-upstream induction (DI-U-1; env-toggle on auth-proxy).
- `ssr-instances-produce-identical-html.feature` — `docker compose up -d --scale web-ssr=2` subprocess + HTTP probes.
- `loader-fanout-to-auth-proxy-stays-bounded.feature` — workload generator + auth-proxy access-log counter.
- `rrv7-handler-renders-existing-routes.feature` (walking skeleton) — single HTTP probe against `/`.

**How to apply**:

- `pyproject.toml` declares `pytest>=7.0.0`, `httpx>=0.27.0`, `pyyaml>=6.0`. **No playwright dependency at DISTILL.**
- The `requires_compose_stack` fixture probes `http://localhost:5173/health` (proxied to `auth-proxy/health` per the existing nginx rule).
- A `driver.py` module exposes helpers: `get(path)`, `compose_services()`, `repo_path(*parts)`, `grep_repo(pattern, paths)`.
- DELIVER's first action when un-skipping the §3.1 DOM-fingerprint scenario is to choose between (a) adding `playwright-python` to `pyproject.toml`, (b) moving the scenario to `e2e/`, or (c) reducing it to an HTML-shape assertion. The roadmap step that unpends §3.1 names this choice as an exit criterion.

**Source**: nw-distill SKILL.md §"Walking Skeleton Strategy Decision" + §"Adapter Scenario Coverage", brief §"Test framework choice", comparison of `tests/acceptance/ibis-as-only-sql-compiler/` (pytest) and `tests/acceptance/user-flow-state-machines/` (TS Cucumber).

---

## DI-3: Carpaccio slicing — **4 slices (MR-0 plumbing + 3 progressive migrations)**

**Decision**: The feature lands across **four DELIVER MRs**:

| Slice | DELIVER MR | Scope | Scenarios unpended |
|---|---|---|---|
| **Slice 1** | **MR-0** | RRv7 framework mode plumbing (zero behavior change). All MR-0 files per handoff §1. `ui-presentation/` dissolves. `App.tsx` deleted. `web-ssr` compose service ships. nginx rule swap. Every route library-mode (no `loader` exports). | walking-skeleton (post-MR-0 e2e shell pass-through) + §3.1 (visual parity) + §3.5 (ui-presentation dissolution) + §3.7 (App.tsx deletion) + §3.8 (container delta) |
| **Slice 2** | **MR-1** | First per-route migration. Adds a `loader` to one route (likely `/login` per DESIGN's worked example) that prefetches via `uiStateClient(request)` and dehydrates a TanStack Query cache. Removes the AppShell-inner `<QueryProvider>` per DWD-7. | §3.2 (SSR'd route migration) + §3.6 (loader auth forwarding / AuthProvider client-only) |
| **Slice 3** | **MR-2** | Demonstrates reversibility + chat opt-out. Reverts the Slice-2 migrated route back to library-mode (proving symmetry), then adds a `clientLoader` to a chat-bearing route to demonstrate DWD-3. | §3.3 (reversibility) + §3.4 (chat `clientLoader`-only + ADR-015 preservation) |
| **Slice 4** | **MR-3** | Operational readiness. Validates Praxis's F-2/F-3/F-4 additions: loader-timeout handling (web-ssr 500s rather than hangs when auth-proxy is slow), horizontal scale (two `web-ssr` instances produce identical SSR'd HTML), auth-proxy fan-out bound (≤ 10% baseline QPS increase under a representative migration profile). | Praxis additions (loader timeout, horizontal scale, fan-out bound) |

**Rationale**:

- **MR-0 is a single atomic merge** (ADR-034 §"Migration sequence" row 1 + handoff §1.5). It MUST land as one slice. Splitting MR-0 across multiple MRs leaves a half-state where some plumbing files exist and others don't — exactly the dual-truth failure mode the ADR retires.
- **Slices 2–4 are independently shippable.** Each adds one observable property. None depends on a later slice for correctness.
- **Slice 3 deliberately reverses Slice 2's migration** before adding the chat `clientLoader` — this is the cheapest possible reversibility test (revert what you just did) and avoids needing a second route to migrate-then-revert.
- **Slice 4 is operational-readiness only.** It does not migrate any new routes. It validates the operational properties Praxis identified as gaps. This isolates ops-grade testing from feature-grade testing.

**Anti-rationale (why not more slices)**:

- More slices = more MRs = more refinery cycle latency for the same scope. 4 slices is the natural Carpaccio thickness: each slice ships one observable property, each takes ~1 day of DELIVER work.
- Splitting MR-0 (e.g., "first the web-ssr container, then ui-presentation/ dissolves, then App.tsx deletes") creates intermediate states that aren't a valid topology — ADR-034 explicitly rejects this.

**How to apply**:

- `roadmap.json` has exactly 4 phases (id `01`..`04`), each with `scenarios_to_unskip` enumerating the .feature/scenario pairs that move from `@skip` to live as part of that phase.
- DELIVER's first action per phase: remove `@skip` from the listed scenarios, run them GREEN, then refactor.

**Source**: nw-distill SKILL.md §"Walking Skeleton First", brief §"Carpaccio slicing", ADR-034 §"Migration sequence", handoff §1.5 ("MR-0 is no-behavior-change plumbing").

---

## DI-4: Walking-skeleton scenario shape — **post-MR-0 SSR'd-shell round trip**

**Decision**: The walking-skeleton scenario is the **first end-to-end probe DELIVER must turn GREEN** after MR-0 ships. It asserts:

> Given the post-MR-0 compose stack is up,
> When a browser requests `/` against `reverse-proxy:5173`,
> Then nginx proxies the request to `web-ssr:3001`,
> And `web-ssr` returns a 200 `text/html` response,
> And the response body is a well-formed HTML document with a `<div id="root">` shell and a `<script>` referencing the client bundle,
> And the response body does NOT contain a stack-trace or a 500 error page.

**Rationale**:

- This is the **minimum end-to-end** scenario that exercises every layer (browser → nginx → web-ssr → SSR pass-through → HTML response). It is the contract every subsequent scenario rides.
- It is **library-mode-aware**: at MR-0 every route is library-mode (no loader), so the SSR response is a structural shell + Scripts bootstrap. No data-fetching is asserted — that's Slice 2's job.
- It is **Strategy-C compatible**: requires the compose stack to be up; skips cleanly otherwise.
- Per `nw-distill` SKILL.md §"Walking Skeleton First", "Walking skeleton scenarios exercise the end-to-end path through driving adapters (real user-facing entry → real driven adapters → real user-visible output) with minimal business logic." This scenario does exactly that.

**Tagging**: `@walking_skeleton @real-io @driving_port @slice-1`. It is the ONE scenario per feature marked `@walking_skeleton` per the skill mandate. Filename: `rrv7-handler-renders-existing-routes.feature` — names the behavior (the RRv7 SSR handler renders pre-MR-0 routes as library-mode shells) rather than the wave phase.

**Source**: nw-distill SKILL.md §"Driving Adapter Verification (Mandatory)", handoff §3.1 sub-scenario "MR-0 reaches web-ssr for the catch-all".

---

## DI-5: Praxis additions encoded as Slice-4 scenarios

**Decision**: The three additions from `review-by-system-designer.md` §5 land as **three behavior-first `.feature` files** (one per asserted invariant), unpended by Slice 4 (MR-3):

- `loader-fails-fast-when-auth-proxy-slow.feature` — loader timeout handling.
- `ssr-instances-produce-identical-html.feature` — horizontal-scale assertion.
- `loader-fanout-to-auth-proxy-stays-bounded.feature` — F-2 auth-proxy fan-out bound.

The three invariants:

1. **F-2 acceptance assertion** (`auth-proxy` fan-out bound). Quantification target: under a representative request mix that simulates 50% of routes being framework-mode, the `auth-proxy` request volume increase is bounded at **≤ 10% above the pre-migration baseline**. The exact baseline is measured in DELIVER (no DESIGN-time number was given); DISTILL fixes the contract shape and the 10% ceiling.
2. **Loader timeout handling** (operational readiness). Given `auth-proxy` is slowed to a 10s response, when `web-ssr` receives a request whose loader fetches from `auth-proxy`, then the response to the browser is a 500 or 504 **within a bounded budget (≤ 5s wall-clock)**, NOT a hang.
3. **Horizontal scale assertion**. Given two `web-ssr` instances behind nginx (`docker compose up -d --scale web-ssr=2`), when a sequence of requests is issued for the same route, then every instance produces **byte-equivalent SSR'd HTML** (modulo a request-id header if present). Validates the scale-N property in application-architecture.md §6.4.

**Rationale**:

- Praxis flagged these as **operational-readiness gaps** in the design (F-2 MEDIUM, F-3 LOW, F-4 LOW). The design itself does not change; DISTILL closes the gap by writing acceptance scenarios that DELIVER (or post-DELIVER ops work) can validate.
- Bundling them into Slice 4 keeps ops-grade tests out of the early plumbing/migration slices. If they fail, they don't block MR-0..MR-2 from shipping.
- The 10% ceiling for F-2 is a rough budget per Praxis's recommendation ("Even a rough budget ('≤ 10% above baseline') in the test gives DELIVER a concrete trigger to measure"). The exact baseline (steady-state `auth-proxy` QPS) is measured during DELIVER Slice 4.

**Source**: `review-by-system-designer.md` §5 ("Additional acceptance scenarios DISTILL should add"), §7 ("Resolution log") F-2/F-3/F-4 deferrals.

---

## DI-6: Per-feature dependency pinning — **no new top-level frontend dependency at DISTILL**

**Decision**: The acceptance suite's `pyproject.toml` declares only Python dependencies (`pytest`, `httpx`, `pyyaml`). **No additions to `frontend/package.json`** at DISTILL. **No additions to root `package.json`** at DISTILL.

**Rationale**:

- The brief explicitly says "Do NOT install new dependencies" at DISTILL — the test framework decision is documented, the actual install happens in DELIVER.
- The acceptance suite's Python dependencies live entirely under `tests/acceptance/frontend-coexistence/pyproject.toml` + its own venv. They do not touch the workspace package graph.
- This preserves the brief's invariant: "Do NOT modify any production code." The acceptance suite is invisible to `frontend/`, `agent/`, `auth-proxy/`, `ui-state/`, `backend/`, `shared/`, `worker/`, `ui-presentation/`.

**How to apply**:

- `tests/acceptance/frontend-coexistence/pyproject.toml` declares its own dependency group.
- The suite is invoked from inside the directory: `cd tests/acceptance/frontend-coexistence && uv run --no-project pytest`.
- DELIVER may add `playwright-python` to `pyproject.toml` if it un-skips the DOM-fingerprint scenario as a browser test rather than an HTML-shape test (per DI-2's deferred decision).

**Source**: brief §"What you should NOT do in this wave" item 2, CLAUDE.md §"acceptance suites".

---

## DI-7: Scope discipline — Mandate 7 (RED scaffolding) is N/A for this feature

**Decision**: Mandate 7 (DISTILL writes minimal stub files for production modules the tests import) is **not load-bearing for this feature**. The acceptance tests probe HTTP responses, file-system state, and `docker compose` output — they do not import any production modules from `frontend/`, `agent/`, `auth-proxy/`, `ui-state/`, `backend/`, `shared/`, or `worker/`. No scaffolds need to be created.

**Rationale**:

- Mandate 7 exists to prevent BROKEN classification (ImportError) when DISTILL writes tests against not-yet-existing production code. This feature's acceptance tests use HTTP, subprocess, and pathlib only — they have nothing to import from production.
- The `__SCAFFOLD__ = True` marker pattern applies to language-level imports. Topology-level tests have no such imports.
- All RED tests fail (skip) cleanly today: `requires_compose_stack` skips when `web-ssr` is not in the topology; file-presence tests skip when the post-MR-0 file tree isn't on disk; HTML-shape tests skip when the route isn't migrated yet.

**Source**: nw-distill SKILL.md §"Mandate 7: RED-Ready Scaffolding" ("Every acceptance test MUST be RED, not BROKEN, when first created").

---

## DI-8: All scenarios are `@skip` at the DISTILL → DELIVER handoff (one-at-a-time unpend)

**Decision**: Every scenario in this DISTILL suite — including the walking-skeleton — is marked `@skip` (via `pytest.mark.skip(reason=...)`) at the DISTILL→DELIVER handoff. DELIVER's first action for each `roadmap.json` phase is to un-skip the scenarios listed in `scenarios_to_unskip`, run them GREEN, then refactor.

**Rationale**:

- The brief's explicit constraint: "Do NOT write tests that PASS today (they should be RED, asserting the post-DELIVER state)." None of the post-MR-0 properties are true today (no `web-ssr` container, no RRv7 plumbing, no `frontend/app/`). Every scenario asserts the post-MR-0 (or post-MR-N) state.
- The `--auto` gate falls through to `--backend` (`cd backend && pytest`); our suite at `tests/acceptance/frontend-coexistence/` is not collected by that gate path. But if a developer runs the suite locally (`cd tests/acceptance/frontend-coexistence && uv run --no-project pytest`), every test should SKIP with a named reason — never fail.
- The skill mandate "one scenario enabled at a time" matches DELIVER's per-step `scenarios_to_unskip` workflow.

**How to apply**:

- Each `test_*.py` function has `pytestmark = [pytest.mark.skip(reason="DISTILL: pending DELIVER phase NN per roadmap.json")]`.
- The walking-skeleton test has `pytestmark = [pytest.mark.skip(reason="DISTILL: pending DELIVER phase 01 — MR-0 plumbing"), pytest.mark.real_io, pytest.mark.walking_skeleton]`. The skip is the outermost decorator (it fires before fixture resolution).

**Source**: brief §"What you should NOT do in this wave" item 4, nw-distill SKILL.md §"One-at-a-Time Strategy".

---

## Reconciliation notes

- **Wave-decision reconciliation (Pre-Scenario Gate)**: walked all DESIGN-wave DWDs (DWD-1..DWD-8) and found **zero contradictions** between DESIGN and DISTILL choices. DISTILL adds operational/test-strategy concerns; it does not re-litigate any application-level decision.
- **Praxis review reconciliation**: Praxis (`review-by-system-designer.md`) raised F-1 (resolved inline pre-DISTILL), F-2 (DI-5 encodes the assertion), F-3 (resolved inline), F-4 (deferred to DELIVER measurement). All four findings are accounted for.
- **DISCUSS/SPIKE/DEVOPS artifacts missing**: the feature entered at DESIGN per CLAUDE.md's brownfield routing matrix. No discussion / spike / devops directories exist at `docs/feature/frontend-coexistence/`. Per nw-distill skill §"Graceful Degradation": warning logged, scenario writing proceeds against DESIGN as the single upstream input.

---

## Cross-references

- DESIGN wave-decisions: [`../design/wave-decisions.md`](../design/wave-decisions.md) — DWD-1..DWD-8 (immutable for this wave).
- DESIGN handoff: [`../design/handoff-design-to-distill.md`](../design/handoff-design-to-distill.md) — 8 BDD scenario groups (§3.1..§3.8).
- Praxis review: [`../design/review-by-system-designer.md`](../design/review-by-system-designer.md) — 3 acceptance additions (F-2, plus two from §5).
- ADR-034 (canonical): `docs/decisions/adr-034-frontend-coexistence-via-rrv7-framework-mode.md`.
- ADR-033 (layer separation): `docs/decisions/adr-033-source-tree-topology-separation.md`.
- ADR-015 (presentation-state nginx rule — preserved): `docs/decisions/adr-015-headless-presentation-state-retrieval.md`.
- ADR-029 (`active_scope` propagation): `docs/decisions/adr-029-active-scope-propagation-contract.md`.
- Reference acceptance suite (pytest + httpx + Strategy-C): `tests/acceptance/ibis-as-only-sql-compiler/`.
- Reference acceptance suite (TS Cucumber — for comparison): `tests/acceptance/user-flow-state-machines/`.
