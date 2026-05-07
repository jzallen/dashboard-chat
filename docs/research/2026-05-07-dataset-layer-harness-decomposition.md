# DatasetLayerHarness — Decomposition Research

**Date:** 2026-05-07
**Author:** dave (crew, dashboard_chat)
**Audience:** Mayor (decision-maker)
**Status:** Research input — design and shipped outcome are recorded in
[`docs/evolution/2026-05-07-refactor-dataset-layer-harness.md`](../evolution/2026-05-07-refactor-dataset-layer-harness.md). The original design doc (per-module file layout, since superseded by Mayor's inline-only scope override) is preserved in git history at commit `981008f`.
**Baseline:** `origin/main` @ `f9465a8` (after `dc-9u1` test pre-assertions, `dc-v5u`
`row_count`, and `dc-u43` compose URL fix landed)
**Supersedes:** the stale roadmap previously filed under `dc-4dp` ("single
DatasetLayerApiClient extraction") — Mayor explicitly redirected away from that shape.

---

## 1. Why this research exists

`backend/tests/integration/dataset_layer/harness.py` is **749 lines** with one class
(`DatasetLayerHarness`) carrying **14 public methods** and 4 private ones, plus 9
module-level helpers. Mayor wants a sharper decomposition than the dc-4dp roadmap
proposed (which extracted one monolithic API client). The target shape:

1. **One wrapper per API endpoint family** (not one client for all endpoints).
2. **A mapper layer** between API JSON and harness-domain dataclasses.
3. **A slim harness facade** that holds only assertions, lifecycle, and chat
   orchestration — no HTTP, no JSON unwrapping.

This research inventories the harness against that shape so Mayor can roadmap
phases with confidence about what moves where.

---

## 2. Method-by-method inventory

Every public method, every private method, every module-level helper — with
file:line, signature, what it does, and which proposed component it belongs in.

Proposed component column legend:
- **PA** = `ProjectsApi`
- **UA** = `UploadsApi`
- **DA** = `DatasetsApi`
- **SA** = `SessionsApi`
- **TA** = `TransformsApi`
- **CA** = `ChatApi`
- **AA** = `AuthApi` (token helpers — currently module-level, a natural cohort)
- **MAP** = mapper (response → domain dataclass)
- **HF** = harness facade (assertions, lifecycle, chat orchestration)
- **U** = utility (kept at module level or moved to `_util.py`)

### 2.1 Public surface (instance methods)

| # | Name | Lines | Signature | What it does | Component | Mixed? (HTTP + assert) |
|---|---|---|---|---|---|---|
| 1 | `__aenter__` | 231–235 | `() → DatasetLayerHarness` | Open `httpx.AsyncClient`; auto-create project if not provided | HF (lifecycle) | No |
| 2 | `__aexit__` | 237–247 | `(*_) → None` | Auto-delete project; close client | HF (lifecycle) — delegates DELETE to PA | No |
| 3 | `create_project` | 251–261 | `(name: str) → str` | `POST {auth-proxy}/api/projects` → unwrap `id` | PA + MAP | Yes — HTTP + unwrap |
| 4 | `upload_csv` | 263–280 | `(csv_path, project_id?) → str` (dataset_id) | Multipart `POST /api/uploads` → unwrap dataset id | UA + MAP | Yes |
| 5 | `chat_turn` | 282–333 | `(prompt, *, dataset_id?, table_schema?, thread_id?, max_retries=2, post_turn_check?) → ChatEventTrace` | Drive turn via `_drive_one_turn`; AC1.4 raw-tool-call check; retry-with-rephrase budget | HF orchestration over CA | Yes — orchestration + AC check |
| 6 | `get_table_state` | 335–352 | `(dataset_id, *, preview_limit=100) → TableState` | `GET /api/datasets/{id}?include_preview=true&preview_limit=N` → map to `TableState` | DA + MAP | Yes — HTTP + mapping |
| 7 | `assert_distinct_values` | 354–363 | `(dataset_id, column, expected: set[str]) → None` | Re-fetch state; preview reduce; assert set equality | HF (assertion only) | **No — pure assertion if state is injected** |
| 8 | `assert_no_nulls` | 365–368 | `(dataset_id, column) → None` | Re-fetch state; preview filter | HF (assertion only) | No |
| 9 | `assert_column_type` | 370–373 | `(dataset_id, column, expected_type) → None` | Re-fetch state; column-type lookup | HF (assertion only) | No |
| 10 | `assert_no_leading_trailing_whitespace` | 375–382 | `(dataset_id, column) → None` | Re-fetch state; whitespace filter | HF (assertion only) | No |
| 11 | `count_by` | 384–399 | `(dataset_id, column) → dict[str, int]` | Re-fetch state; preview reduce | **DEAD CODE** per `dc-9u1` commit message; `dc-grb` tracks removal | — |
| 12 | `create_session` | 403–426 | `(project_id?) → dict[str, Any]` | `POST /api/projects/{p}/sessions` → unwrap data dict | SA + MAP | Yes |
| 13 | `list_session_events` | 428–464 | `(session_id, *, since=None, limit=100) → list[dict]` | Paginated `GET /api/sessions/{id}/events`; drains `has_more` | SA + MAP | Yes |
| 14 | `assert_exactly_once_via_replay` | 466–499 | `(session_id, *, idempotency_key, expected_event_type, correlation_field='transform_id') → dict` | Calls `list_session_events`; filters; asserts exactly one match | HF (cross-product assertion) | No (assertion only after extracting list call) |
| 15 | `post_transforms_direct` | 501–522 | `(dataset_id, body, *, idempotency_key?) → httpx.Response` | Direct `POST /api/datasets/{id}/transforms` w/ `Idempotency-Key` | TA | No (returns raw response by design) |
| 16 | `patch_transforms_direct` | 524–543 | `(dataset_id, body, *, idempotency_key?) → httpx.Response` | Direct `PATCH /api/datasets/{id}/transforms` | TA | No |
| 17 | `list_dataset_transforms` | 545–559 | `(dataset_id) → list[dict]` | `GET /api/datasets/{id}?include_transforms=true` → unwrap → return `transforms` list | DA + MAP | Yes |

### 2.2 Private methods

| Name | Lines | What it does | Component |
|---|---|---|---|
| `_require_client` | 563–568 | Guard: must be in `async with` | HF |
| `_backend_headers` | 570–575 | Build `Authorization` (PAT or JWT) + optional `Content-Type` | shared header builder — **HF private OR a small `_http.py` shared infra module** |
| `_agent_headers` | 577–583 | Build `Authorization` (always JWT) + `Content-Type` for the worker | CA private |
| `_drive_one_turn` | 585–616 | One SSE round-trip to `{agent_url}/chat`; build body; parse v6 frames | CA |

### 2.3 Module-level helpers and types

| Name | Lines | What it does | Component |
|---|---|---|---|
| `ChatEventTrace` (dataclass) | 55–68 | DTO for chat events | MAP (chat domain) |
| `TableState` (dataclass) | 71–84 | DTO for table view | MAP (datasets domain) |
| `_V6_FRAME_SEPARATOR`, `_V6_DATA_PREFIX`, `_V6_DONE_SENTINEL`, `_RAW_TOOL_CHUNK_TYPES` | 112–122 | SSE frame constants | CA private |
| `_parse_v6_sse(body)` | 125–146 | Decode v6 SSE bytes → list of UIMessageChunk dicts | CA private |
| `parse_chat_event_frames(body)` | 149–167 | Surface `data-chat-event` payloads + raw-tool-call sentinel | CA — **public re-export required** (see §3) |
| `_new_ulid_suffix()` | 175–184 | 13-char base32 suffix for project key | U |
| `fetch_dev_user_jwt(auth_proxy_url, *, code)` | 624–642 | POST `/api/auth/callback` → return JWT | AA |
| `mint_pat(auth_proxy_url, user_jwt, *, name, expires_in_seconds)` | 645–673 | POST `/api/auth/pats` → `(pat_id, token)` | AA |
| `revoke_pat(auth_proxy_url, user_jwt, pat_id)` | 676–682 | DELETE `/api/auth/pats/{id}` | AA |
| `_default_rephrase(original, attempt)` | 690–705 | Lookup-table rephraser for AC1.5 | CA (rephrase strategy) **OR** HF (chat orchestration policy) — pick |
| `_project_id_from_response(body)` | 708–715 | Tolerant `id` extractor | MAP (projects) |
| `_dataset_id_from_response(body)` | 718–724 | Tolerant `id`/`dataset_id` extractor | MAP (datasets) |
| `_unwrap_jsonapi(body)` | 727–737 | Flatten `{data:{id, attributes:{...}}}` → `{id, ...}` | MAP (shared) |
| `required_env_or_skip_reason(names)` | 745–749 | Conftest skip-reason helper | U (kept at module level — already used by conftest, unrelated to refactor) |

### 2.4 Tally

| Component | Public methods + helpers landing here |
|---|---|
| **PA** ProjectsApi | `create_project`, project DELETE used by `__aexit__`, `_project_id_from_response` |
| **UA** UploadsApi | `upload_csv`, `_dataset_id_from_response` |
| **DA** DatasetsApi | `get_table_state`, `list_dataset_transforms` |
| **SA** SessionsApi | `create_session`, `list_session_events` |
| **TA** TransformsApi | `post_transforms_direct`, `patch_transforms_direct` |
| **CA** ChatApi | `_drive_one_turn`, SSE parsers (`_parse_v6_sse`, `parse_chat_event_frames`), v6 constants, `_default_rephrase` (debatable), `_agent_headers` |
| **AA** AuthApi | `fetch_dev_user_jwt`, `mint_pat`, `revoke_pat` |
| **MAP** Mappers | `TableState`, `ChatEventTrace`, plus three new domain types (§4), and the JSON:API unwrap |
| **HF** Facade | lifecycle, all 5 (post-`count_by`-removal) `assert_*` methods, `assert_exactly_once_via_replay`, `chat_turn` retry-with-rephrase orchestration |
| **U** Utility | `_new_ulid_suffix`, `required_env_or_skip_reason` |

Six wrapper classes (PA, UA, DA, SA, TA, CA) plus an Auth helper module — within
Mayor's "pause if more than 6–7 wrapper classes" guidance. **No scope alarm.**

---

## 3. Mixed-concern seams (HTTP + assertion entanglement)

Mixed methods (per §2.1 last column): **#3, #4, #5, #6, #12, #13, #17.**

The only one with a *non-trivial* seam is `chat_turn` (#5). The other six just need
their HTTP body extracted into the relevant `*Api` wrapper and the response mapped
through the mapper layer. Mechanical.

`chat_turn`'s mixed concerns:

1. **HTTP/SSE delivery** — currently `_drive_one_turn`. Belongs in `ChatApi`.
2. **AC1.4 invariant** ("no raw Groq tool-call delta leaks") — currently raises in
   `chat_turn:310–314`. The check inputs are the trace fields `events` and
   `raw_tool_call_seen` already produced by `parse_chat_event_frames`. Two
   options:
   - **Option A (recommended):** the check stays in the harness facade. Mayor's
     directive is "harness = assertions only" — and AC1.4 *is* an assertion. The
     harness asserts on a `ChatEventTrace` returned by `ChatApi.send_turn(...)`.
     Clean.
   - Option B: ChatApi raises. Pulls a test-policy assertion into a transport
     adapter — wrong layer.
3. **Retry-with-rephrase budget (AC1.5)** — currently the `for attempt in
   range(attempts)` loop in `chat_turn:303–333`. This is the orchestration the user
   pays the harness facade to provide. Two options:
   - **Option A (recommended):** retry stays in the **harness facade**. The harness
     is the entity with knowledge of `post_turn_check` (test policy) and the
     `rephrase` strategy. ChatApi just sends a single turn.
   - Option B: ChatApi exposes a retry parameter. Couples a transport adapter to a
     test-orchestration concern.

**My pick: Option A on both.** ChatApi is a *single-turn transport adapter*
(`async def send_turn(prompt, *, dataset_id, table_schema, thread_id) → ChatEventTrace`).
The harness facade owns the retry loop, the AC1.4 invariant check, and the
`post_turn_check` orchestration.

**Hard constraint:** `parse_chat_event_frames` is currently re-imported from
`harness.py` by **both** `test_harness_sse.py:25` and `test_wire_contract.py:25`.
After moving the parser into a `_chat_api.py` module the harness module must
**re-export** the symbol (`from ._chat_api import parse_chat_event_frames`) or those
tests break. Trivial to satisfy; flagging because it's a stability boundary.

---

## 4. Domain types (mapper layer)

Today the harness has two dataclasses (`TableState`, `ChatEventTrace`). The
remaining response shapes are returned as raw `dict[str, Any]` or as a primitive
(`str` for ids).

### Existing dataclasses

- `TableState` (lines 71–84): `dataset_id`, `row_count`, `columns`, `preview` +
  `column_type(column)` lookup. Already idiomatic; mapper just moves alongside it.
- `ChatEventTrace` (lines 55–68): `events`, `raw_tool_call_seen` + `of_type`
  helper + `turn_done` accessor. Already idiomatic.

### New dataclasses needed

To get the facade to consume *only* domain objects, three new types are warranted:

1. **`ProjectId`** — could be a `str` `NewType` or a tiny dataclass
   `Project(id: str)`. Recommend `NewType("ProjectId", str)` — zero runtime cost,
   helps type-checking distinguish from dataset/session ids. Same for `DatasetId`
   and `SessionId`.
2. **`SessionState`** — currently `create_session` returns `dict[str, Any]`. The
   only fields callers consume per a quick grep are `id` and `stream_thread_id`.
   Dataclass fields: `id: SessionId`, `stream_thread_id: str`, plus an `extra:
   dict[str, Any]` for forward-compat. Mappers fail loudly if `id` or
   `stream_thread_id` is missing (current code raises `RuntimeError` already).
3. **`TransformRecord`** — currently `list_dataset_transforms` returns
   `list[dict]`. The integration test consumers (
   `test_replay_idempotency.py:294+`) read fields like `id`, `kind`, `params`. A
   `frozen=True` dataclass makes the intent contract explicit:
   `id: str`, `kind: str`, `params: dict[str, Any]`, `created_at: str | None`.

For the **idempotency-key direct-POST surface** (`post_transforms_direct`,
`patch_transforms_direct`) the harness deliberately returns raw `httpx.Response`
because the test asserts on **status code, headers, body shape simultaneously**
(see commit message: "explicit retry semantics"). **Don't** wrap these in a domain
mapper — that would lose the headers and the status code. *Keep them returning
`httpx.Response`*; the wrapper just centralizes the URL composition + auth header.

### What the mappers do

For each `*Api`-method-that-returns-domain pair, one mapping function:

```
def to_project(body: dict) → ProjectId
def to_dataset_id(body: dict) → DatasetId
def to_table_state(body: dict, dataset_id: DatasetId) → TableState
def to_session(body: dict) → SessionState
def to_transform_records(body: dict) → list[TransformRecord]
def to_session_events(body: dict) → tuple[list[dict[str, Any]], str | None, bool]
   # returns (events, next_cursor, has_more) — the events themselves stay
   # dict-shaped because they're heterogeneous DomainEvents whose schema
   # lives in shared/chat/events.ts (out-of-scope to retype here).
```

`_unwrap_jsonapi` becomes the shared utility that mappers compose with.

---

## 5. Retry-with-rephrase logic — chat-orchestration concern (stays on facade)

The retry budget (`max_retries: int = 2`, AC1.5), the `_default_rephrase` lookup
table, the post-turn-check policy, and the call site that decides "rephrase ↔
retry" are all **test orchestration**. ChatApi is too low. Justification:

1. The check itself (`post_turn_check`) is a *test author's callable*. ChatApi has
   no business knowing what the test will assert.
2. The rephrase strategy is configurable in `__init__` (the `rephrase` parameter,
   line 217). Tests inject custom rephrasers. That signals "harness-owned policy",
   not transport-layer concern.
3. Single-responsibility: ChatApi sends one turn over SSE and returns the parsed
   trace. The retry loop has *zero* dependence on HTTP behavior — only on
   `post_turn_check` raising or not.

**Decision: stays in the harness facade.** ChatApi exposes single-turn
`send_turn(...)`; the facade wraps it in the retry budget.

---

## 6. Test consumers — signature stability

Three integration tests + two parser tests consume the harness. Method-call
inventory across them (grep `h\.`):

```
h.assert_distinct_values
h.assert_exactly_once_via_replay
h.assert_no_leading_trailing_whitespace
h.assert_no_nulls
h.chat_turn
h.create_session
h.get_table_state
h.list_dataset_transforms
h.list_session_events
h.patch_transforms_direct
h.post_transforms_direct
h.upload_csv
```

All 12 listed methods come from the harness facade per §2.4. **Public method
signatures on the facade can be preserved verbatim.** The decomposition is
**internal**: the facade methods become thin delegates, e.g.

```python
async def upload_csv(self, csv_path, project_id=None) → str:
    target = project_id or self._project_id
    return await self._uploads.upload_csv(target, csv_path)  # returns DatasetId/str
```

Module-level imports today:
- `from .harness import DatasetLayerHarness` (3 tests)
- `from .harness import parse_chat_event_frames` (2 tests — see §3 hard
  constraint)

**Both must continue to work.** Re-exporting `parse_chat_event_frames` from
`harness.py` after the parser moves is the only stability cost.

---

## 7. Recently merged constraints to accommodate

### `dc-9u1` (commit `027267a`) — pre-assertion structural pattern

`test_dataset_staging_layer.py` now captures pre-state via `get_table_state`
*before* each `chat_turn`, then asserts dirty preconditions. This means
`get_table_state` is on the **hot path** of the test (called once per op for
pre-state, once for post-assertion) — it must stay fast and stable. The mapper
indirection adds a single function call per fetch — negligible. **No design
constraint violated.**

The same commit notes: `count_by` is dead; `dc-grb` tracks removal. The
decomposition can either:
- **Option:** include `count_by` removal as a Phase 0 cleanup task (one-line
  delete in harness.py, no test impact since no test calls it). Recommended —
  shrinks the surface before extraction.
- Or leave it for `dc-grb` to handle independently; the refactor just maps it to
  DA. The risk: someone copies the dead method into the new wrapper. Removing
  first is cheaper.

### `dc-v5u` (commit `4e3f785`) — `row_count` now exposed by GET

`get_table_state` (lines 335–352) **already** consumes `data.get("row_count")` as
the first source — this commit landed. No mapping change needed; the existing
fallback chain (`row_count` → `rows` → `len(preview)`) survives and is a feature
(it tolerates older endpoint behavior during rollout). The mapper preserves the
fallback chain verbatim.

### `dc-u43` (commit `d196383`) — compose URL fix

Hardcoded container-internal URLs in compose. **Zero impact on the harness
refactor** — the harness already takes `auth_proxy_url` and `agent_url` via
`__init__`, both of which are conftest-injected. URL handling is unchanged.

---

## 8. Migration cost / churn footprint

| Movement | Files affected | Approx. LOC |
|---|---|---|
| New `_api/projects.py` (1 method, 1 constructor, ~25 LOC) | new | +25 |
| New `_api/uploads.py` | new | +30 |
| New `_api/datasets.py` (2 methods) | new | +50 |
| New `_api/sessions.py` (2 methods, paging) | new | +55 |
| New `_api/transforms.py` (2 methods) | new | +35 |
| New `_api/chat.py` (single-turn + SSE parser + v6 constants) | new | +90 |
| New `_api/auth.py` (3 helpers) | new | +50 |
| New `_mappers/` (or `_mappers.py`) — domain types + mapping fns | new | +100 |
| `harness.py` slimmed to facade only (lifecycle + assertions + chat orchestration + `parse_chat_event_frames` re-export) | edit | from 749 → ~280 |
| Test consumers | unchanged | 0 |

**Net:** ~750 LOC stays roughly the same (perhaps slightly larger due to type
plumbing), but the largest single file shrinks from 749 → ~280 LOC, and 6 new
files top out at ~90 LOC each.

Effort estimate: **~2 sessions of focused work** for a polecat (not 1 — there are
6 wrappers + a mapper layer to land safely). A single-session "boil the ocean"
PR is contraindicated; phased migration with the integration suite green at every
phase boundary is the safety net.

---

## 9. Risks

1. **Refactoring tests is dangerous when tests ARE the regression net.** The
   harness *is* the test infrastructure for the dataset layer. The standard
   Feathers-style "pin behavior with characterization tests" applies, but the
   characterization tests *are* `test_dataset_staging_layer.py`,
   `test_replay_idempotency.py`, etc. Mitigation: keep facade signatures
   identical; run the integration suite at each phase boundary; bias toward
   **internal** refactoring before any signature change.
2. **`parse_chat_event_frames` import path stability.** Two test modules import
   it directly. Mitigation: re-export from `harness.py`. (§3 hard constraint.)
3. **`count_by` removal vs. preservation.** dc-grb tracks deletion; the
   decomposition could either include it or wait. Recommend Phase 0 (kill
   `count_by` + the now-unused `_default_rephrase` if no test injects rephrase —
   but `_default_rephrase` *is* used as the lookup-table fallback in
   `chat_turn`'s rephrase chain, so it stays).
4. **Import cycle risk.** `_api/chat.py` may want `ChatEventTrace`; `_mappers/`
   defines `ChatEventTrace`. The mapper module must *not* import from
   `_api/`. Conventional shape: `_mappers/` is a leaf, `_api/` imports from
   `_mappers/`, `harness.py` imports from both. No cycle.
5. **Header-builder duplication.** `_backend_headers` and `_agent_headers`
   currently coexist on the harness. After extraction, every `*Api` needs a
   header builder. Two patterns work:
   - **Pattern A (recommended):** one shared `_http.py` with
     `bearer(token, *, json_body=False) → dict[str, str]`. Every wrapper takes
     the token in its constructor and builds headers via the shared utility.
     Avoids 6 duplicate `_backend_headers` methods.
   - Pattern B: a `BackendCredentials(jwt: str, pat: str | None)` value object
     and an `AgentCredentials(jwt: str)` value object. Wrappers take the
     appropriate credential type. More verbose.

   §3 of the design picks one.

---

## 10. Hand-off

- Shipped outcome is recorded in
  [`docs/evolution/2026-05-07-refactor-dataset-layer-harness.md`](../evolution/2026-05-07-refactor-dataset-layer-harness.md);
  the original DESIGN-wave artifact (per-module file layout, superseded by Mayor's
  inline-only scope override) is preserved in git at commit `981008f`.
- Delivery shape: Mayor reviewed → answered open questions → opened bead epic
  `dc-wcy` (one bead per phase, mirroring the Stream.io epic shape) → polecats
  executed via `/nw-deliver` per phase.

---

## 11. Sources

Codebase-internal. Every claim cites `path:line` in this working tree at
`origin/main` SHA `f9465a8`. The recent-landing constraints (§7) cite git commit
SHAs. No third-party documentation claims; the trusted-source-domains config
(`.nwave/trusted-source-domains.yaml`) was honored by the `nw-research` skill
orchestration but is not load-bearing here.
