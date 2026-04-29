# DESIGN Decisions — api-driven-user-flow-tests

## Key Decisions

- **[D1] Design scope = Application** (not System or Domain). Test infra change touching auth flow + backend + worker; no new system topology.
- **[D2] Interaction mode = Propose.**
- **[D3] Q1 — Groq non-determinism**: combine pin model + temp=0 + seed (where exposed), assert on table state (not tool-call sequences), retry-with-rephrase up to 2× per op (matches AC1.5). Mocking the LLM is out of bounds per the Guiding Principle. See `design.md` §5.
- **[D4] Q2 — Test surface**: real `docker compose up -d` of the SUT (backend + worker + query-engine + MinIO). Pytest runs outside the compose network, reaches services via published ports. In-process ASGI is forbidden (fidelity violation). Boot/teardown budget defended in `design.md` §6.
- **[D5] Q3 — Worker driving + runner**: pytest in `backend/tests/integration/dataset_layer/`; worker reached via real HTTP + SSE consumed with `httpx-sse` (or `httpx` async). Reuses existing JWT minting, fixture patterns, conftest investment. Vitest and polyglot rejected as net complexity.
- **[D6] Q4 — Data lifecycle**: per-test project, ULID-keyed (e.g., `dataset-staging-01HZA9XK...`), deleted in pytest function-scoped teardown. Project-delete cascade handles dependent DuckDB views and MinIO objects. Shared-fixture-with-reset and disposable testcontainers rejected.
- **[D7] Skip C4 diagrams.** Cross-cutting test infra; no new architectural component. Per user direction.
- **[D8] Skip domain modeling.** No domain change. Per user direction.
- **[D9] Skip SSOT `docs/product/architecture/brief.md` bootstrap.** Project predates SSOT model adoption (same rationale as `dc-1k8` and `api-driven-user-flow-tests/discuss/wave-decisions.md` D6).
- **[D10] ~~Tool-dispatcher mimics the frontend's responsibility.~~** **SUPERSEDED 2026-04-29 by `worker-tool-dispatch-refactor` (PRs 1–3, merged).** Original decision: a Python `ToolCallDispatcher` would interpret `applyCleaningTransform` tool-calls from the SSE stream and POST to `/api/datasets/{id}/transforms`. **Replacement**: the worker is now the single tool dispatcher; it persists state via the backend and emits a typed `ChatEvent` SSE vocabulary (see `agent/lib/chat/events.ts`). The harness only consumes typed events and asserts on table state via `GET /api/datasets/{id}`. AC1.4 verified by `rg -wi 'groq|sse|tool_call|tool_calls' backend/app/` returning zero matches. The walking-skeleton test at `agent/test/chat/acceptance/walking-skeleton.test.ts` is the permanent guard on this contract. See `design.md` §2 for the resolution paragraph.
- **[D11] `agent/index.ts:21` GROQ_API_KEY hard-fail is config'd around, not refactored.** Real key sourced from CI secret or `.env.test` (gitignored). Anti-goal to refactor the worker. See `design.md` §11.
- **[D12] Test CSV is copied into the test fixture dir** (not symlinked or referenced by absolute path) so CI is portable and the fixture is versioned with the test code. Default applied; user can override in §12.

## Architecture Summary

- **Pattern**: Test harness as a thin Python adapter to the production HTTP surface (no architectural pattern change to the SUT itself).
- **Paradigm**: Python (pytest, async/await) for the harness; matches existing project paradigm. No new paradigm.
- **Key new components**:
  - `backend/tests/integration/dataset_layer/harness.py` (NEW) — `DatasetLayerHarness`, `ChatEvent` consumer, `TableState` dataclass. ~150–250 LOC (smaller post-`worker-tool-dispatch-refactor`; no Python dispatcher needed).
  - `backend/tests/integration/dataset_layer/conftest.py` (NEW) — session fixture for compose-up, function fixture for per-test project, explicit disable of parent `auto_mock_s3` autouse.
  - `backend/tests/integration/dataset_layer/test_dataset_staging_layer.py` (NEW) — the acceptance test itself, shaped per `design.md` §10.
  - `docker-compose.test.yml` or `.env.test` (NEW) — test-only env (`AUTH_MODE=dev`, pinned `GROQ_MODEL`, `GROQ_TEMPERATURE=0`, `GROQ_API_KEY` from CI secret).
- **Key extended components**:
  - `backend/tests/integration/test_api.py` patterns (httpx + dev JWT + Bearer header) carried forward; transport switched from ASGITransport to real HTTP base_url.
  - `agent/lib/chat/handleChat.ts` config plumbing — verify `GROQ_MODEL`, `GROQ_TEMPERATURE`, `GROQ_SEED` are env-driven; ~5 LOC if not.

## Reuse Analysis

(Mirrored from `design.md` §4.)

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| FastAPI integration test harness | `backend/tests/integration/test_api.py` | httpx + dev-JWT pattern | EXTEND, switch transport to real HTTP | Pattern carries; transport must change for fidelity |
| Dev JWT minter | `backend/app/auth/dev_provider._mint_jwt`, `backend/app/auth/dev_keys` | RS256 JWT shared with worker via JWKS | EXTEND | Use as-is. Worker auth (`agent/lib/auth.ts`) already trusts backend JWKS in dev mode |
| Worker chat handler | `agent/lib/chat/handleChat.ts` | The endpoint under test | EXTEND (no code change beyond config) | Reach via real HTTP |
| Worker dispatcher + typed `ChatEvent` vocabulary | `agent/lib/chat/dispatchers/{index,cleaning,mutations,ui}.ts`, `agent/lib/chat/events.ts` | The contract the harness asserts against | REUSE | Worker is the single tool dispatcher (post `worker-tool-dispatch-refactor`). Harness consumes typed events; no Python-side dispatcher needed. |
| Compose stack | `docker-compose.yml` | All four services + DB + MinIO + query-engine | EXTEND via overlay or env file | Test-only env (model pinning, dev mode) |
| Pytest config + conftest | `backend/pyproject.toml`, `backend/tests/conftest.py` | Test runner | EXTEND | New subdir conftest for the dataset-layer suite |
| MinIO mock (autouse) | `backend/tests/conftest.py:auto_mock_s3` | Existing mock would defeat fidelity | DEVIATE | New conftest scope explicitly disables this autouse for the dataset-layer subtree |

**Zero unjustified `CREATE NEW`.**

## Technology Stack

- **Pytest** + `httpx` + `httpx-sse` (new dep — minimal; alternative: hand-roll SSE on `httpx.aiter_lines`, ~30 LOC).
- **`docker-compose`** — already present, extended via overlay or `.env.test`.
- **Real Groq** + `@ai-sdk/groq` (already present in worker).
- **Real MinIO** + `boto3` (already present, used by lake repository).
- **Real DuckDB** via pg_duckdb in the query-engine container (already present).

No new languages, frameworks, or infrastructure components.

## Constraints Established (DESIGN-side)

- Compose stack must be reachable on stable, published ports (`backend:8000`, `worker:8787`, `minio:9000`, `query-engine:5432`). Tests fail-fast at session-fixture if any health endpoint is unreachable within 60s.
- The dataset-layer test subtree's conftest MUST disable the parent `auto_mock_s3` autouse — fidelity-critical. A test-of-the-test asserts MinIO sees real PUT requests during the upload step.
- `GROQ_API_KEY` env var is required at compose-up time; missing key is a fast-failing config error, not a test failure.
- Pinned `GROQ_MODEL` is the same string in CI and local. If production model changes, this string changes via the same PR (model rollout is a coordinated change, not a CI-only knob).

## Upstream Changes

- **AC1.4 is verified by construction post `worker-tool-dispatch-refactor`** (PRs 1–3, merged 2026-04-28/29). The backend is chat-unaware: `rg -wi 'groq|sse|tool_call|tool_calls' backend/app/` returns zero matches. The harness sends a chat turn, observes the worker's typed `ChatEvent` SSE stream, and asserts on table state via `GET /api/datasets/{id}`. The earlier "two-step LLM behavior (preview tool → `applyCleaningTransform`)" framing was a frontend-era artifact; with the worker as the single dispatcher, the harness has no client-side tool dispatch and the protocol is one round-trip per turn.

## Routing Forward

1. **DISTILL** (`/nw-distill`) — encode `test_dataset_staging_layer.py` per `design.md` §10's worked example. The test will fail end-to-end on the first run because the harness doesn't exist yet (Iron Rule satisfied).
2. **DELIVER** (`/nw-deliver`) — Outside-In TDD inside-out from one cleanup op:
   1. Inner loop 1: `DatasetLayerHarness.upload_csv` + `get_table_state`. Drives backend only. First green.
   2. Inner loop 2: `chat_turn` for the simplest op (`Trim whitespace on every text column`) end-to-end. SSE-frame parsing against `ChatEventSchema`; assert on table state via `GET /api/datasets/{id}`. Mirror `agent/test/chat/acceptance/walking-skeleton.test.ts` in pytest. First chat round-trip green.
   3. Inner loop 3: parametrize `chat_turn` over the full 10-op workload. Acceptance green.
   4. Inner loop 4: `count_by` aggregated reads. Final two reads green.
   5. Inner loop 5: retry-with-rephrase + structured failure messages (AC1.5, AC1.9).
3. **FINALIZE** (`/nw-finalize`).

## Open Questions (deferred to user — `design.md` §12)

1. `GROQ_MODEL` pinning — read from current production config or pick explicitly?
2. CSV fixture — copy into test dir vs absolute path?
3. Test env separation — `docker-compose.test.yml` vs `.env.test`?
4. Stale-project sweep job — yes or trust pytest teardown?

Defaults applied at DELIVER if unanswered: pin to the model `agent/lib/chat/handleChat.ts` already references; copy CSV into fixtures; `.env.test`; skip sweep job.
