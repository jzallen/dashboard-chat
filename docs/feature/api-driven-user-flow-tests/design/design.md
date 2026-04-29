# Design — api-driven-user-flow-tests

> **✅ STATUS: UNBLOCKED (revised 2026-04-29).** The protocol that this design depended on shipped via `worker-tool-dispatch-refactor` PRs 1–3 (commits `0510f52`, `c9c40fd`, `0a19079`). The worker is now the single tool dispatcher and emits a typed `ChatEvent` vocabulary on the SSE stream (`agent/lib/chat/events.ts`); backend stays chat-unaware (`rg -wi 'groq|sse|tool_call|tool_calls' backend/app/` returns zero matches, AC1.4). The former "Python `ToolCallDispatcher`" wrinkle in §2 is gone; §10 (worked example) collapses to "send prompt to `/chat`, observe `ChatEvent`s on SSE, query backend state via `/api/datasets/{id}`." The walking-skeleton test at `agent/test/chat/acceptance/walking-skeleton.test.ts` is the permanent guard on this contract.


> **Status**: proposed
> **Source**: `docs/feature/api-driven-user-flow-tests/discuss/{user-stories,outcome-kpis,wave-decisions}.md`
> **Mode (D1)**: Propose
> **Scope (D0)**: Application
> **Skipped (per user direction)**: C4 diagrams, domain modeling, SSOT `brief.md` bootstrap

---

## 1. Problem framing

DISCUSS established one story (headless dataset (staging) layer test), nine AC, and four open questions (Q1–Q4) under a binding **Guiding Principle**: only WorkOS auth is substituted (dev JWT); every other production dependency runs as in production. This document answers Q1–Q4 with one decision each, defends the AC1.6 wall-clock budget, surfaces a code-level wrinkle DISCUSS did not have visibility into, and provides DISTILL with a concrete shape to aim at.

## 2. Protocol contract (post worker-tool-dispatch-refactor)

This section originally described a "Python tool dispatcher" wrinkle: the test harness mimicking the frontend's interpretation of tool calls. **That wrinkle is gone.** The `worker-tool-dispatch-refactor` feature (PRs 1–3, merged) made the worker the single dispatcher: it interprets every Groq tool-call inside `agent/lib/chat/handleChat.ts` and emits a typed `ChatEvent` discriminated union on the SSE stream. The frontend (and any test harness) subscribes to those events; nobody dispatches tool calls a second time.

The harness contract is therefore minimal:

1. POST to worker `/chat` with the user message + current `tableSchema`.
2. Read the SSE stream and parse each frame as a `ChatEvent` per `agent/lib/chat/events.ts` (`assistant_text_delta`, `transform_applied`, `column_renamed`, `row_added`, `row_deleted`, `transform_undone`, `transform_re_enabled`, `sort_directive`, `filter_directive`, `filters_cleared`, `error_occurred`, `turn_done`).
3. After `turn_done` (or after observing the relevant `transform_applied` / mutation event), GET `/api/datasets/{dataset_id}` and assert on the resulting table state.

No client-side tool dispatch. No POST to `/api/datasets/{id}/transforms` from the harness. No `tableSchema` refresh between turns beyond what the test cares to assert.

**AC1.4 is verified by construction**: the backend has zero references to `groq`, `sse`, `tool_call`, or `tool_calls` (use the word-boundary form `rg -wi` to avoid false positives like "accessed" / "processed"). The structural scenario in DISTILL re-verifies this guard as a permanent regression check.

## 3. Constraints (carried from DISCUSS)

| # | Constraint | Source |
|---|---|---|
| C1 | Auth path is `_mint_jwt()` (RS256, dev_keys) — no WorkOS | DISCUSS C1, AC1.2 |
| C2 | Headless — no browser, no Playwright | DISCUSS C2 |
| C3 | Demo doc is the workload contract (10 cleanup ops + 2 count queries) | DISCUSS C3, AC1.4 |
| C4 | CI-affordable — wall-clock ≤ 5 min | DISCUSS C4, AC1.6 |
| C5 | Production fidelity — only WorkOS substituted; Groq/MinIO/DuckDB/worker/backend all real | DISCUSS Guiding Principle, AC1.2, AC1.8 |
| C6 | `agent/index.ts:21` requires `GROQ_API_KEY` — refactoring it away is anti-goal | DISCUSS Constraints |
| C7 | Reusability is a side effect; no premature framework | DISCUSS Constraints |
| C8 | Reprompt budget ≤ 2 per cleanup op | AC1.5 |

## 4. Existing-codebase landscape (Reuse Analysis)

| Existing Component | File | Overlap with this feature | Decision | Justification |
|---|---|---|---|---|
| FastAPI integration test harness (httpx + ASGITransport) | `backend/tests/integration/test_api.py` | Already drives `/api/projects` with dev JWTs | EXTEND but **switch transport** | The pattern carries over (httpx + Bearer dev JWT). Keep the JWT minting + headers helpers; **replace ASGITransport with a real HTTP base_url** pointing at the compose-hosted backend. Per-fidelity policy. |
| Dev JWT minter | `backend/app/auth/dev_provider.py:_mint_jwt`, `backend/app/auth/dev_keys.py` | Produces RS256 JWTs validated by both backend and worker (worker reads JWKS from backend at `/.well-known/jwks.json`) | EXTEND | Use as-is. The worker's `agent/lib/auth.ts` already trusts the backend's JWKS in dev mode (`AUTH_MODE=dev`, `JWKS_URL=http://localhost:8000/.well-known/jwks.json`). |
| Worker chat handler | `agent/lib/chat/handleChat.ts` | The endpoint the test must drive | EXTEND (no changes) | Reach via real HTTP to `worker:8787/chat`. SSE parsing in pytest via `httpx-sse` or equivalent. |
| Worker dispatcher + typed `ChatEvent` vocabulary | `agent/lib/chat/dispatchers/{index,cleaning,mutations,ui}.ts`, `agent/lib/chat/events.ts` | The contract the harness asserts against | REUSE (no harness-side dispatcher) | Worker is the single tool dispatcher; harness only consumes typed events. No Python equivalent of the old "frontend tool dispatcher" is needed. Walking-skeleton test (`agent/test/chat/acceptance/walking-skeleton.test.ts`) is the permanent guard on the contract. |
| Compose stack | `docker-compose.yml` (root) | All four services + DB + MinIO + query-engine | EXTEND | A `docker-compose.test.yml` overlay (or a marker env-var to compose) that swaps `AUTH_MODE=workos` for `AUTH_MODE=dev` if it isn't already. Likely already dev by default in local. |
| Pytest config | `backend/pyproject.toml`, `backend/tests/conftest.py` | Test runner + fixtures | EXTEND | Add a `tests/integration/dataset_layer/` subdir with its own conftest hosting the compose-up fixture and `DatasetLayerHarness`. |
| MinIO test bucket lifecycle | `backend/tests/conftest.py` (`mock_s3` autouse) | Today the integration tests use a moto-style mock | **DEVIATE** — DISCUSS Guiding Principle forbids mocking | Use the real MinIO from compose. The existing `auto_mock_s3` autouse must NOT apply to the dataset-layer tests. New conftest scope keeps that boundary clean. |

**Zero unjustified `CREATE NEW`.** All harness components either extend existing infra or read the worker's typed event stream — no Python-side dispatcher is needed.

## 5. Q1 — Managing Groq non-determinism

**Decision**: combine **(a) + (b) + (c)** — pin model + temp=0 + seed where supported; assert on table state, not tool-call sequences; retry-with-rephrase up to 2× per cleanup op.

### Mechanics

- **Pin model.** Worker reads `GROQ_MODEL` env var (defaulting to whatever production uses). Test compose overlay sets `GROQ_MODEL` to a specific pinned model + `GROQ_TEMPERATURE=0` + a fixed `GROQ_SEED` if the SDK exposes one. Verify via reading `agent/lib/chat/handleChat.ts` and the `@ai-sdk/groq` provider — if seed is not exposed, drop that dial; the other two carry the determinism load.
- **Assert on table state.** The harness's per-turn assertion runs `GET /api/datasets/{id}` (or a preview endpoint) and inspects the resulting JSON for the AC1.4 invariants — distinct values, type, null counts. Tool-call **sequences** are logged for debugging but not asserted.
- **Retry-with-rephrase.** If the post-turn assertion fails, the harness rephrases the prompt using a small lookup table (e.g., `Trim whitespace on every text column` → `Remove leading and trailing spaces from all text columns`) and retries. After 2 rephrases the test fails with a structured error including the SSE transcript and the table-state diff (per AC1.9).

### Why not the alternatives

- **Mock the LLM** — out of bounds per the Guiding Principle (DISCUSS settled this).
- **Pin only, no retry** — too brittle; one Groq hiccup tanks the suite. K3 ≥ 95% would be at risk.
- **Retry only, no pinning** — leaves performance on the floor. Pinning gets us most of the determinism for free.

### Cost estimate

- 10 cleanup ops × 1.05 average attempts (with pinning) × ~3s Groq round-trip = **~32s** for the chat workload in a green run.
- Worst-case (every op needs 2 rephrases): 10 × 3 × 3s = 90s. Still inside AC1.6.

## 6. Q2 — Test surface

**Decision**: real `docker compose up -d` of the SUT (option (a)). The pytest process runs **outside** the compose network and reaches services via published ports. No in-process ASGI; that's a fidelity violation.

### Mechanics

- A session-scoped pytest fixture runs `docker compose up -d backend worker query-engine minio` once per test session, then `docker compose down -v` at session end. The frontend, agent (chat-only), and auth-proxy are excluded from the test stack — they are not in the SUT path for API-driven tests.
- A `wait_for_health` helper polls `http://localhost:8000/health` and `http://localhost:8787/health` with a 60s timeout before tests run.
- Tests read service URLs from env (`DC_BACKEND_URL`, `DC_WORKER_URL`) — defaults match the published-port convention; CI may override if compose is networked differently.

### Boot/teardown budget defense

| Step | Cold | Warm |
|---|---|---|
| `docker compose up -d` | 30–60s (image pulls, healthchecks) | 5–10s (already running) |
| Health-poll | 10–20s | 1–5s |
| Per-test setup (project + CSV upload + dataset-ready poll) | 10–15s | 10–15s |
| 10 chat turns (with retry budget) | 30–90s | 30–90s |
| 2 count queries | 5–10s | 5–10s |
| Per-test teardown (project delete) | 3–5s | 3–5s |
| `docker compose down -v` | 5–10s | n/a |
| **Per-test wall-clock** | **~90–210s** | **~50–125s** |

AC1.6 (≤ 5 min = 300s) is met in both scenarios with > 30% headroom in the worst case. CI strategy: start compose **once per CI job** (session scope), run all dataset-layer flows in sequence, tear down at job end — amortizing the 30–60s cold-start cost across all flows in the suite.

### Why not the alternatives

- **Hybrid (b)** — same fidelity as (a), differs only in test-process placement. Either works; DESIGN picks (a) because pytest-from-host is the simplest topology and what the existing `test_api.py` already implies.
- **In-process (c)** — fidelity violation. Skips uvicorn middleware, real network, real SSE, real auth header propagation. Forbidden by the Guiding Principle.

## 7. Q3 — Worker driving and runner

**Decision**: pytest. Worker reached via real HTTP (`POST http://localhost:8787/chat`), SSE consumed with `httpx-sse` (or `httpx` async + `aiter_lines`).

### Mechanics

- Test directory: `backend/tests/integration/dataset_layer/` (new). Why backend/tests: it's where pytest lives; the test exercises the backend's API surface; reuses dev JWT minting from there. The fact that the worker is also driven is incidental — worker is just another HTTP service.
- New harness module: `backend/tests/integration/dataset_layer/harness.py` (or split into multiple files as it grows). Public API:

  ```python
  class DatasetLayerHarness:
      async def __aenter__(self): ...                        # boot fixture, get IDs
      async def __aexit__(self, *_): ...                     # cleanup
      async def create_project(name: str) -> str: ...
      async def upload_csv(project_id, csv_path) -> str: ... # returns dataset_id
      async def chat_turn(prompt: str, *, max_retries=2) -> ChatEventTrace: ...
      async def get_table_state(dataset_id) -> TableState: ...
      async def assert_distinct_values(dataset_id, column, expected: set[str]): ...
      async def assert_no_nulls(dataset_id, column): ...
      async def assert_column_type(dataset_id, column, expected_type): ...
      async def count_by(dataset_id, column) -> dict[str, int]: ...
  ```

- Inside `chat_turn`: opens an SSE connection to worker `/chat`, parses each frame into a typed `ChatEvent` per `agent/lib/chat/events.ts`, accumulates them into a `ChatEventTrace`, waits until `turn_done` (or the relevant mutation event), then returns the trace. **No client-side dispatch** — the worker has already persisted any state changes by the time the corresponding `transform_applied` / `column_renamed` / `row_added` / etc. event lands. Per-turn assertions then GET `/api/datasets/{id}` for table-state checks (AC1.4 invariants).

### Why not the alternatives

- **vitest** — doable, but reinvents what `backend/tests/integration/` already provides (JWT helpers, fixtures, conftest patterns). Splitting test code across two runners hurts the K4 "marginal effort to add the next flow" KPI.
- **Polyglot (pytest + vitest)** — strictly more complexity than (a). No fidelity benefit.
- **Refactor handler for direct invocation** — fidelity violation. The whole point is to drive the real SSE path.

## 8. Q4 — Data lifecycle

**Decision**: per-test project, ULID-keyed (e.g., `dataset-staging-01HZA9XK...`). Deleted in pytest teardown (function scope). DuckDB views and MinIO objects scoped to the project are cleaned up by the existing project-delete cascade.

### Mechanics

- Test fixture `dataset_layer_project` creates a project at the start of each test, captures its ID, and deletes it at the end (try/finally, so even failed tests clean up).
- Fixture is function-scoped (one project per test). Cheap because project-create is `< 100ms` and delete is `< 1s`.
- A nightly maintenance job (out of scope for this feature; flagged for ops to schedule) sweeps stale `dataset-staging-*` projects older than 24h in case a test process crashes mid-run and skips its teardown. This is belt-and-suspenders, not a primary mechanism.

### Why not the alternatives

- **Shared fixture project with reset** — saves project-create cost (~100ms × N tests) at the price of harder failure-mode reasoning. Not worth it for a small number of tests.
- **Disposable testcontainers** — over-engineering. The compose stack already exists; per-test stack churn is wasted boot time and breaks AC1.6.

## 9. Component impact

| Layer | File(s) | Change |
|---|---|---|
| Test infra | `backend/tests/integration/dataset_layer/__init__.py` (NEW) | Package marker |
| Test infra | `backend/tests/integration/dataset_layer/conftest.py` (NEW) | Session fixture for `docker compose up -d`; function fixture for per-test project; **explicitly disables** the parent `auto_mock_s3` autouse for this subtree (per Reuse Analysis row) |
| Test infra | `backend/tests/integration/dataset_layer/harness.py` (NEW) | `DatasetLayerHarness` + `ChatEvent` consumer + `TableState` dataclass. ~150–250 LOC (smaller now that no Python tool dispatcher is needed; the worker persists state before emitting the corresponding typed event). |
| Test infra | `backend/tests/integration/dataset_layer/test_dataset_staging_layer.py` (NEW) | The actual acceptance test — one `test_dataset_staging_layer` function that walks the demo doc workload using the harness |
| Test data | `backend/tests/integration/dataset_layer/fixtures/ecommerce-orders.csv` (NEW or symlink) | Either copy from `/usr/local/share/dc-demo-data/` (CI portability) or symlink (local dev). DESIGN recommends copying; treat the demo CSV as a versioned test fixture |
| Compose overlay | `docker-compose.test.yml` (NEW) — or env in `.env.test` | Set `AUTH_MODE=dev`, `GROQ_API_KEY=$GROQ_TEST_API_KEY`, `GROQ_MODEL=<pinned>`, `GROQ_TEMPERATURE=0`. Source `GROQ_TEST_API_KEY` from CI secrets; locally from `.env.test` |
| Worker | `agent/lib/chat/handleChat.ts` | **Verify** model/temperature/seed are read from env. If not, add ~5 LOC to thread them through. Likely no change beyond config plumbing |
| CI | `.github/workflows/<existing-ci>.yml` (path TBD by DEVOPS wave) | New job: `dataset-layer-tests` running `RUN_INTEGRATION_TESTS=1 pytest backend/tests/integration/dataset_layer/`. Compose stack started at job-start, torn down at job-end |
| Docs | `docs/feature/api-driven-user-flow-tests/design/` | This file + wave-decisions.md |

**Estimated total**: 1 new test file, 1 new conftest, 1 new harness module, 1 new compose overlay (or env file), ~5–10 LOC config plumbing in worker, 1 CI job. ~250–450 LOC of new test code total (revised down from ~400–600 — no Python dispatcher).

## 10. Worked example — the shape DISTILL should aim at

The intent is for `test_dataset_staging_layer.py` to read like the demo doc's "Act 3" table, with each turn collapsing to one harness call. With the worker as the single dispatcher, `chat_turn` reduces to: send prompt → observe `ChatEvent`s on the SSE stream → return when `turn_done` lands; per-turn assertions GET `/api/datasets/{id}` for the AC1.4 invariants.

```python
# backend/tests/integration/dataset_layer/test_dataset_staging_layer.py
import pathlib
import pytest
from .harness import DatasetLayerHarness

DEMO_CSV = pathlib.Path(__file__).parent / "fixtures" / "ecommerce-orders.csv"


@pytest.mark.asyncio
async def test_dataset_staging_layer(dataset_layer_project):
    """Drive the dataset (staging) layer's full chat-driven cleanup workload
    headlessly via the API. Workload script: docs/strategy/demo-staging-2026-04-26.md.
    """
    async with DatasetLayerHarness(project_id=dataset_layer_project) as h:
        # ----- Setup: upload CSV -----
        dataset_id = await h.upload_csv(DEMO_CSV)
        state = await h.get_table_state(dataset_id)
        assert state.row_count == 250
        assert len(state.columns) == 11

        # ----- Cleanup operation 1: trim whitespace -----
        trace = await h.chat_turn("Trim whitespace on every text column")
        # Optional protocol-level checks on the typed event vocabulary:
        assert any(e.type == "transform_applied" and e.operation == "trim"
                   for e in trace.events)
        # Authoritative state check (AC1.4 invariants live on table state):
        for col in ("region", "customer_email", "product_category",
                    "payment_method", "shipping_status"):
            await h.assert_no_leading_trailing_whitespace(dataset_id, col)

        # ----- Cleanup operation 2: standardize region to title case -----
        await h.chat_turn("Standardize the region column to title case")
        await h.assert_distinct_values(
            dataset_id, "region", {"North", "South", "East", "West"}
        )

        # ----- Cleanup operation 3: fix typo + standardize category -----
        await h.chat_turn(
            'The product category has typos — fix "Electornics" to '
            '"Electronics" and standardize everything to title case'
        )
        await h.assert_distinct_values(
            dataset_id, "product_category",
            {"Electronics", "Apparel", "Home Goods", "Books", "Toys"}
        )

        # ... operations 4–8 in the same shape ...

        # ----- Read 1: count by region -----
        by_region = await h.count_by(dataset_id, "region")
        assert sum(by_region.values()) == 250
        assert len(by_region) == 4

        # ----- Read 2: count by product_category -----
        by_cat = await h.count_by(dataset_id, "product_category")
        assert sum(by_cat.values()) == 250
        assert len(by_cat) == 5
```

The harness method `chat_turn(prompt)` encapsulates: POST `/chat` → consume the SSE stream → parse each frame into a `ChatEvent` per `agent/lib/chat/events.ts` → return a `ChatEventTrace` when `turn_done` lands. Tests assert on table state via `GET /api/datasets/{id}`; protocol-level event assertions are optional debugging affordances. The harness manages the AC1.5 retry budget via a small rephrase table; tool-call sequences are not asserted (Q1 decision).

**Note on `transform_id`**: `POST /api/datasets/{id}/transforms` currently returns `{ok: True}` only. The worker dispatcher synthesizes a transient `transform_id` for the `transform_applied` event so the FE has a stable handle for invalidation. Tests that need a server-authoritative id should query `/api/datasets/{id}` for the latest transform, not rely on the synthesized value.

**Reference implementation**: `agent/test/chat/acceptance/walking-skeleton.test.ts` is the permanent guard on this protocol contract. It posts to worker `/chat`, parses frames against `ChatEventSchema`, asserts the `transform_applied` shape, and asserts that no raw Groq tool-call deltas (frame prefix `9:`) leak through. The Python harness mirrors that shape in pytest.

This shape is a contract for DISTILL: write the test FIRST (it'll fail end-to-end on the first run, as the Iron Rule requires), then DELIVER builds the harness inner-loop until the test goes green.

## 11. `agent/index.ts:21` GROQ_API_KEY hard-fail handling

The worker exits at startup if `GROQ_API_KEY` is unset. Per the Guiding Principle, refactoring this is an anti-goal. Therefore:

- **CI**: source `GROQ_API_KEY` from a CI secret (e.g., `GROQ_TEST_API_KEY` mapped into the worker container's environment). Use a Groq account/key dedicated to tests with a separate spend cap, so a runaway test cannot exhaust production budget.
- **Local**: developer must set `GROQ_TEST_API_KEY` in `.env.test` (gitignored). The conftest's compose-up fixture sources `.env.test` if present and fails fast with a clear message if neither `.env.test` nor the env var is found.
- **Cost control**: a soft alarm at 1k requests/day on the test key. AC1.6's wall-clock budget already caps per-run cost; the alarm catches accidental loops.

This is config + ops, not code. Zero changes to `agent/`.

## 12. Open questions for the user

1. **GROQ_MODEL pinning.** What model does production use today? DESIGN recommends pinning to that exact model (avoid drift between test and prod). If production uses model auto-routing, we pick one explicitly (recommendation: `llama-3.3-70b-versatile` or whatever the current production prompt is tested against). **Default if no answer**: read `agent/lib/chat/handleChat.ts` for the current `createGroq` config and pin to that.
2. **CSV fixture location.** Copy the demo CSV into `backend/tests/integration/dataset_layer/fixtures/` (CI-portable, versioned), or keep the absolute `/usr/local/share/dc-demo-data/` path (matches demo doc, but breaks CI). **Default**: copy into the test fixture dir.
3. **Compose overlay vs `.env.test`.** Both work; `docker-compose.test.yml` is more explicit, `.env.test` is lighter weight. **Default**: `.env.test` for the few env-var differences (test uses dev mode + pinned model), gitignored, with a `.env.test.example` checked in.
4. **Cleanup of stale dataset-staging-* projects.** Worth the nightly sweep job, or do we trust pytest's try/finally? **Default**: skip the sweep job in this feature; revisit if the orphan rate becomes a real signal.

If unanswered, defaults will be applied at DISTILL/DELIVER and recorded in this directory's wave-decisions.md.

## 13. ADR-style summary

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Context** | Validating the dataset (staging) layer today requires a 15-min recorded browser demo. We need a headless API-driven test that mirrors production end-to-end (only WorkOS substituted), runs ≤ 5 min, and gates merges with ≥ 95% pass rate. |
| **Decision** | Pytest-driven harness in `backend/tests/integration/dataset_layer/` reaches a real `docker compose up -d` SUT (backend + worker + query-engine + MinIO) over published ports. Auth via `_mint_jwt()` (RS256 dev JWT, validated by both backend and worker via the existing JWKS path). Worker uses real Groq with pinned model + temp=0 and is the **single tool dispatcher** (post `worker-tool-dispatch-refactor`); the harness consumes the worker's typed `ChatEvent` SSE vocabulary and asserts on table state via `GET /api/datasets/{id}`. No client-side tool dispatch in the harness. Per-cleanup-op retry budget of 2 absorbs LLM jitter; assertions live on table state, not tool-call sequences. Per-test project, ULID-keyed, deleted in teardown. |
| **Alternatives considered** | LLM mocking (forbidden by Guiding Principle); in-process ASGI (forbidden); vitest runner (reinvents existing pytest infra, hurts K4); shared fixture project (failure-mode complexity not worth the saved milliseconds); refactoring worker to allow stub provider (anti-goal per DISCUSS C6); Python-side tool dispatcher mimicking the frontend (superseded — worker is now the single dispatcher, see §2). |
| **Consequences** | New test directory and harness module (~250–450 LOC, smaller than originally scoped because no Python dispatcher is needed). New compose overlay or `.env.test`. New CI job. No changes to backend or worker code beyond verifying env-driven model/temp/seed config. Real Groq spend on every CI run (controlled by pinned model + AC1.6 budget + dedicated test key with spend cap). The largest engineering risk is now LLM determinism on the demo workload (Q1 mitigations apply); harness construction is mechanical SSE-frame parsing against `ChatEventSchema`. |
| **Out of scope** | UI / browser tests; view layer, report layer, dbt-export flows; multi-user; performance benchmarking; mocking any production dependency other than WorkOS. |
