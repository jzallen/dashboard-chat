# AC4.3 — verification note

**Bead**: `dc-ms8.4` (final value-validation step of epic `dc-ms8`).
**Verified on**: 2026-04-29.
**Verifying base commit**: `94494d9` — `docs(design): unblock api-driven-user-flow-tests; collapse §2 + §10 (dc-ho4)`,
on top of PRs 1–3 (`0510f52`, `c9c40fd`, `0a19079`) and finalize commit `92b0b40`.

## Status

> **`api-driven-user-flow-tests` is structurally unblocked and ready to resume.**

The protocol contract that the feature depends on shipped via
`worker-tool-dispatch-refactor`. The DESIGN document has been revised in place
to reflect the new shape; the feature can now proceed through DISTILL → DELIVER
without the "Python tool dispatcher" wrinkle that blocked it before.

## What was checked

1. **DESIGN coherence with `main`** — `docs/feature/api-driven-user-flow-tests/design/design.md`
   read end-to-end at HEAD (`94494d9`):
   - **§2** ("Protocol contract"): the former *Python `ToolCallDispatcher`*
     wrinkle is explicitly deleted ("That wrinkle is gone."). The harness contract
     is now `POST /chat → consume SSE → parse ChatEvents → query backend state`.
   - **§10** ("Worked example"): the worked example collapses to that same
     send→observe→query shape (one `chat_turn` per turn, table-state asserts via
     `GET /api/datasets/{id}`).
   - **§4 Reuse Analysis, §7 Q3 Mechanics, §9 Component impact, §13 ADR
     summary**: all consistent with §2 — no Python equivalent of the old
     frontend dispatcher is needed; harness LOC budget revised down accordingly.
   - **Cross-referenced files exist on `main`**:
     `agent/lib/chat/events.ts`, `agent/lib/chat/handleChat.ts`,
     `agent/lib/chat/dispatchers/{index,cleaning,mutations,ui}.ts`,
     `agent/test/chat/acceptance/walking-skeleton.test.ts`.
   - **AC1.4 invariant** holds by construction: `rg -wi 'groq|sse|tool_call|tool_calls' backend/app/`
     returns zero matches at HEAD.

2. **Smoke probe** — added at
   `backend/tests/integration/dataset_layer/test_smoke_chat_cleaning.py`. It
   mirrors the §10 shape for one representative cleaning-tool path
   (`trim_whitespace` on a column):
   - POST worker `/chat` with the trim prompt.
   - Parse the AI SDK SSE stream; extract `ChatEvent` annotations from prefix-`8`
     frames; assert at least one `transform_applied { operation: "trim", column, dataset_id }`
     event lands.
   - Assert no raw Groq tool-call deltas (prefix `9:`) leak — AC1.4 regression
     guard parallel to the worker-side walking skeleton.
   - GET `/api/datasets/{id}?include_preview=true` and assert the targeted
     column has no leading/trailing whitespace in the preview rows.
   - Skip-when-unavailable semantics mirror
     `backend/tests/integration/test_lake_preview_live.py` and
     `agent/test/chat/acceptance/walking-skeleton.test.ts`: the test is a
     permanent guard but only executes when the operator has provisioned
     `AGENT_URL`, `BACKEND_URL`, `SMOKE_DATASET_ID`, `SMOKE_COLUMN` and the
     services are reachable on those URLs.

3. **Smoke probe execution** — `uv run pytest backend/tests/integration/dataset_layer/ -v`
   collects and runs cleanly:
   ```
   tests/integration/dataset_layer/test_smoke_chat_cleaning.py::test_trim_whitespace_via_chat_propagates_to_dataset_state SKIPPED
   ============================== 1 skipped in 1.70s ==============================
   ```
   In a polecat sandbox without compose+GROQ creds the probe correctly skips
   (matching the established live-integration pattern). It runs end-to-end on
   any environment that publishes the four required env vars and brings up
   `docker compose up -d backend worker query-engine minio`.

4. **No regression to the `worker-tool-dispatch-refactor` surface** — only
   additions under `backend/tests/integration/dataset_layer/`; zero production
   code touched. `pytest --collect-only` reports 1140 tests collected
   (1139 pre-existing + 1 new).

## Companion guards (already on `main`)

- `agent/test/chat/acceptance/walking-skeleton.test.ts` — worker-side guard on
  the `transform_applied` event shape and the no-raw-tool-call invariant.
- `agent/test/chat/acceptance/worker-tool-dispatch.test.ts` — full
  worker-tool-dispatch acceptance suite shipped with PR 3.

The new smoke probe is the backend↔worker boundary's complement: it proves the
typed event the worker emits actually corresponds to the dataset state the
backend persists.

## Next-action ownership

The feature is structurally unblocked. **Whoever owns
`api-driven-user-flow-tests` resumption can pick it up from DISTILL** with the
revised DESIGN as the input contract. The smoke probe at
`backend/tests/integration/dataset_layer/test_smoke_chat_cleaning.py` is an
intentional thin slice — DELIVER will grow the full `DatasetLayerHarness`
described in §7 + the demo-doc workload (§10) on top of it. Mayor has been
notified that the gate is open.

## Out of scope for this verification

- Resuming the full DISTILL/DELIVER waves of `api-driven-user-flow-tests`.
- Modifying any production code or any
  `docs/feature/worker-tool-dispatch-refactor/` artifacts (already finalized).
- Building the full `DatasetLayerHarness` (~250–450 LOC per §9). The smoke
  probe is one scenario, not the suite.
