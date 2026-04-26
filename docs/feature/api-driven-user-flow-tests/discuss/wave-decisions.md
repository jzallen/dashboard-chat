# DISCUSS Decisions — api-driven-user-flow-tests

> **🛑 STATUS: BLOCKED on `worker-tool-dispatch-refactor` (2026-04-26).**
> DESIGN review surfaced a fidelity gap: today the **frontend** dispatches Groq's tool-calls to backend endpoints. A Python harness mimicking that dispatcher would be parallel construction, not a faithful test of production. Decision: refactor the worker to dispatch ALL tool calls (both backend-mutating and UI-affecting) and emit a typed SSE event vocabulary the frontend subscribes to. This unblocks an honestly-headless test. The new feature lives at `docs/feature/worker-tool-dispatch-refactor/`. **Resume this feature once the refactor lands.** When resuming, revisit `design.md` §2 (the wrinkle disappears) and §10 (the worked example simplifies — the harness only observes SSE events, no Python tool dispatcher).


## Key Decisions

- **[D1] Feature type = Cross-cutting.** Touches auth (dev JWT path), backend (FastAPI integration test surface), worker (`agent/index.ts` Hono SSE), test infra (new harness or extension of existing pytest), and CI wiring. No domain change.
- **[D2] Walking skeleton = No.** Brownfield; the basic primitives already exist (`backend/tests/integration/test_api.py`, `dev_keys.py`, `_mint_jwt`). The dataset (staging) layer test is itself the first thin slice end-to-end.
- **[D3] UX research depth = Lightweight.** Sole user is a developer running tests; no end-user journey.
- **[D4] JTBD = No.** Single obvious job ("validate user flows headlessly without depending on a browser or external auth").
- **[D5] Lean DISCUSS — Phase 3 (Requirements) only.** Skipping JTBD, journey design, story-map, and elephant-carpaccio slicing. There is one slice (the dataset (staging) layer's headless workload), it has an obvious learning hypothesis ("disproves: chat→agent→backend→DuckDB round-trip works without UI and without WorkOS"), and it cannot be split smaller without losing end-to-end value.
- **[D6] Migration gate (skill-prescribed) — bypassed.** Same rationale as `dc-1k8/discuss/wave-decisions.md` D6: project predates SSOT model adoption; project-wide SSOT migration is disproportionate to a small test-infra feature.
- **[D7] Feature dir uses natural slug `api-driven-user-flow-tests`** per the `feedback_feature_dir_naming.md` memory; no bead ID in the path. A bead may be filed for tracking after stories are accepted, but bead linkage will live in git trailers / bead descriptions, not directory names.
- **[D8] LLM determinism, test surface, worker driving, and data lifecycle are deferred to DESIGN.** See "DESIGN-wave inputs" section below — DISCUSS surfaces the questions but does not pre-decide them.

## Requirements Summary

- Primary user need: a developer can run a single command that exercises the dataset (staging) layer's full chat-driven cleanup workload headlessly via the API, asserting the table state after each step, with auth handled by the local RS256 dev JWT path. No WorkOS, no browser.
- Walking skeleton scope: N/A (not greenfield).
- Feature type: cross-cutting (auth + backend + worker + tests + CI).

## Guiding Principle — Headless Production Fidelity

These tests are a **headless representation of the production application**. The only allowed substitution is WorkOS auth → local dev JWT (`backend/app/auth/dev_provider._mint_jwt`). Every other production dependency — Groq LLM, MinIO, DuckDB, the real worker, the real backend — runs as in production. Mocks, in-memory fakes, or LLM stubs are **disallowed** by default; if any DESIGN-wave proposal wants to introduce one, it must justify the production-fidelity loss and is subject to user override.

This principle resolves what would otherwise be ambiguous trade-offs in DESIGN: when in doubt, choose the option that mirrors production behavior.

## Constraints Established

- **Auth path is fixed.** Tests authenticate via `_mint_jwt()` (RS256, dev_keys-signed) — the production verification code path. No WorkOS network calls.
- **Headless.** No browser, no Playwright. The test must run on a server with no display.
- **The demo doc is the workload contract.** The chat-driven cleanup operations + their "what you should see" expectations in `/workspaces/dashboard-chat/docs/strategy/demo-staging-2026-04-26.md` are the executable acceptance for the dataset (staging) layer. Test prose centers on the layer; the demo doc is cited as the script source, not as the framing.
- **CI-affordable.** Tests must run pre-merge in CI within a budget that does not balloon the suite (target: ≤ 5 minutes wall-clock per dataset-layer run, with Groq round-trips dominant; < 2 min is a stretch goal on local with warm caches).
- **WorkOS is the only forbidden network destination.** Outbound requests to Groq, MinIO, and any other production dependency are expected. Tests that try to mock these defeat the production-fidelity goal.
- **Worker startup requires `GROQ_API_KEY`.** `agent/index.ts:21` exits the process without it. Tests must provide a real Groq key (sourced from CI secrets / dev `.env`); refactoring the worker to accept a stub provider is now an anti-goal, not a candidate solution.
- **Reusability is a side effect, not a goal.** The dataset-layer test is the deliverable. If composing it produces reusable primitives (project-create helper, chat-turn driver, table-state asserter), keep them — but do not pre-design a "test framework."

## Upstream Changes

- None. No DISCOVER artifacts exist; nothing to back-propagate.

## DESIGN-wave Inputs (the four open questions)

These are the architectural decisions DISCUSS deliberately does NOT make. DESIGN must answer each with a recommendation + rationale before DISTILL. The Guiding Principle (production fidelity) is binding — solutions that violate it are out of bounds unless explicitly overridden by the user.

### Q1 — Managing Groq non-determinism within the AC1.5 reprompt budget

**Problem.** The dataset (staging) layer's cleanup operations are mediated by chat → real Groq LLM. The same prompt may yield slightly different tool sequences across runs. The test needs to be reliable enough to gate merges (K3 ≥ 95% pass rate) without sacrificing production fidelity.

**Options DESIGN must weigh** (note: mocking the LLM is **out of bounds** per the Guiding Principle):
- (a) Pin model + temperature=0 + seed (where supported) for maximum determinism within real-Groq runs.
- (b) Tolerate semantic, not syntactic, success: assert on **table state** after each operation rather than on tool-call sequences. The reprompt budget (AC1.5: ≤2) absorbs the rest.
- (c) Add operation-level retry-with-rephrase: if the table state is wrong after a turn, automatically rephrase + retry up to the budget before failing.
- (d) Combine (a) + (b) + (c): pin determinism dials, assert on state, retry within budget.

**Recommended starting position:** option (d) — DESIGN should default here unless it identifies a reason not to. The test path stays production-faithful while the AC1.5 budget gives the suite headroom for real-LLM jitter.

### Q2 — Test surface (in-process vs. real compose)

**Problem.** Backend integration tests today (`backend/tests/integration/test_api.py`) use `ASGITransport` — fast but in-process. Production fidelity demands the test see the same network, container, and SSE behavior end-users do.

**Options DESIGN must weigh** (note: in-process backend conflicts with the Guiding Principle when the worker is real):
- (a) Real `docker compose up -d` for the whole stack; tests hit real ports. Highest fidelity. Slowest boot.
- (b) Hybrid: real worker + real backend container via compose; test runner outside the network. (Same fidelity as (a) for the system under test; differs only in where the test process runs.)
- (c) In-process FastAPI via `ASGITransport` + real worker via HTTP. Cheapest, but skips the FastAPI request lifecycle (uvicorn middleware, startup events, etc.) and diverges from production.

**DISCUSS bias:** option (a) or (b). Option (c) requires DESIGN to explicitly justify a fidelity exception.

### Q3 — Worker driving

**Problem.** `agent/index.ts` is a Hono SSE server requiring `GROQ_API_KEY`. In production, the frontend POSTs to `/chat` and consumes the SSE stream. A test must do the same to be production-faithful.

**Options DESIGN must weigh:**
- (a) Test runner = pytest; worker driven via HTTP (real container in compose) using `httpx-sse` or equivalent.
- (b) Test runner = vitest; worker in compose, driven via `fetch()` + a Web Streams reader.
- (c) Polyglot: pytest drives both backend and worker over HTTP (single language, one runner).

**DISCUSS bias:** all three respect the Guiding Principle (real worker, real network). DESIGN should pick on test-author ergonomics + ecosystem fit, not fidelity. Likely (a) or (c) given the codebase's existing pytest investment.

### Q4 — Data lifecycle

**Problem.** Each run creates a project, uploads a CSV, mutates the dataset, reads aggregates. Re-running needs a clean slate; failed runs must not leak state.

**Options DESIGN must weigh:**
- (a) Per-test project (uniquely named, ULID-keyed); deleted in teardown.
- (b) Shared fixture project; per-test reset via project-delete + recreate.
- (c) Disposable testcontainers per test run (full PostgreSQL + MinIO ephemeral).

**DISCUSS bias:** (a) is the simplest fidelity-respecting option — production handles per-project isolation natively. (c) is over-engineering unless concurrency or cross-test contamination becomes an issue.

## Routing Forward

1. **DESIGN** (`/nw-design`, propose mode) — answer Q1–Q4 with one combined design doc, decide test runner, produce a component-impact list. Output to `docs/feature/api-driven-user-flow-tests/design/`.
2. **DISTILL** (`/nw-distill`) — encode the dataset (staging) layer workload as the BDD acceptance test in whatever runner DESIGN chose; the test will fail end-to-end on the first run (Iron Rule).
3. **DELIVER** (`/nw-deliver`) — Outside-In TDD: build the harness primitives (auth, project-create, dataset-upload, chat-turn driver, table-state asserter) in inner loops until the dataset-layer test goes green.
4. **FINALIZE** (`/nw-finalize`).
