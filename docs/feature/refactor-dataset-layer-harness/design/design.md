# Design: Decompose `DatasetLayerHarness` into per-API wrappers + mappers + assertion-only facade

**Wave:** DESIGN
**Mode:** Propose (recommendation, not Q&A)
**Scope:** System (test-infrastructure refactor, but cuts across multiple API surfaces)
**Author:** dave (crew, dashboard_chat)
**Date:** 2026-05-07
**Decision-maker:** Mayor
**Research input:** [`docs/research/2026-05-07-dataset-layer-harness-decomposition.md`](../../../research/2026-05-07-dataset-layer-harness-decomposition.md)
**Supersedes:** the stale `dc-4dp` design doc proposing a single
`DatasetLayerApiClient` extraction.

---

## 1. Recommendation

**Proceed.** Extract the harness into:

- **6 API wrappers** (one per endpoint family): `ProjectsApi`, `UploadsApi`,
  `DatasetsApi`, `SessionsApi`, `TransformsApi`, `ChatApi`.
- **1 Auth helpers module** (`_api/auth.py`) for the three module-level token
  helpers (`fetch_dev_user_jwt`, `mint_pat`, `revoke_pat`).
- **1 mapper module** (`_mappers.py`) with the existing dataclasses + 3 new
  domain types + tolerant unwrapping functions.
- **1 slim facade** (`harness.py`) holding lifecycle, assertions, and
  chat-turn orchestration only.

Confidence: **high.** Justification:

1. The 14 public methods cluster cleanly into the 6 endpoint-family wrappers
   (research §2.4). No method straddles two wrappers.
2. The hard constraint (`parse_chat_event_frames` import-path stability for two
   parser tests) is satisfiable with a single re-export line — research §3 — so
   the refactor is API-stable for **all** existing callers.
3. The Stream.io epic just shipped a sibling research+design pair on this same
   branch shape. Mirroring the structure makes the polecat experience routine.
4. The largest single file shrinks from 749 → ~280 LOC; new files top out at
   ~90 LOC. No "moved-the-bulk-into-one-file" anti-pattern.

**Rejected alternative — `DatasetLayerApiClient` (one big client class).** Mayor
has already redirected away from this. Per-API wrappers carry HTTP semantics that
differ in subtle ways (multipart vs. JSON, `Idempotency-Key` header, SSE vs.
JSON response, JWT-only-to-worker vs. PAT-or-JWT-to-backend); collapsing them
into one class produces a class that knows too much and a header-builder that
branches on caller intent. Six small classes >> one 700-line god-class.

---

## 2. Target architecture

### 2.1 File layout (under `backend/tests/integration/dataset_layer/`)

```
dataset_layer/
├── __init__.py
├── conftest.py                 (unchanged)
├── harness.py                  (slim facade; ~280 LOC; re-exports
│                                parse_chat_event_frames for back-compat)
├── _http.py                    (NEW — one-line bearer-header builder)
├── _mappers.py                 (NEW — domain dataclasses + unwrap helpers)
├── _api/                       (NEW package)
│   ├── __init__.py
│   ├── projects.py             (ProjectsApi)
│   ├── uploads.py              (UploadsApi)
│   ├── datasets.py             (DatasetsApi)
│   ├── sessions.py             (SessionsApi)
│   ├── transforms.py           (TransformsApi)
│   ├── chat.py                 (ChatApi + v6 SSE parser + constants)
│   └── auth.py                 (token helper functions)
├── fixtures/                   (unchanged)
├── test_dataset_staging_layer.py     (unchanged)
├── test_harness_sse.py               (unchanged — imports
│                                      parse_chat_event_frames via harness)
├── test_replay_idempotency.py        (unchanged)
└── test_wire_contract.py             (unchanged)
```

**Underscore-prefix convention** (`_api/`, `_mappers.py`, `_http.py`) signals
"internal to the integration test infrastructure"; consistent with the existing
`_drive_one_turn`, `_backend_headers`, `_default_rephrase` naming. The facade
remains the only public entry point.

### 2.2 Component contracts

#### `_mappers.py`

```python
from typing import NewType
import dataclasses

ProjectId = NewType("ProjectId", str)
DatasetId = NewType("DatasetId", str)
SessionId = NewType("SessionId", str)

@dataclasses.dataclass(frozen=True)
class TableState:           # moved from harness.py — unchanged shape
    dataset_id: DatasetId
    row_count: int
    columns: list[dict]
    preview: list[dict]

    def column_type(self, column: str) -> str | None: ...

@dataclasses.dataclass
class ChatEventTrace:       # moved from harness.py — unchanged shape
    events: list[dict]
    raw_tool_call_seen: bool = False

    def of_type(self, event_type: str) -> list[dict]: ...
    @property
    def turn_done(self) -> dict | None: ...

@dataclasses.dataclass(frozen=True)
class SessionState:         # NEW
    id: SessionId
    stream_thread_id: str
    extra: dict              # forward-compat for non-essential fields

@dataclasses.dataclass(frozen=True)
class TransformRecord:      # NEW
    id: str
    kind: str
    params: dict
    created_at: str | None

# Tolerant unwrappers (moved from harness.py module level):
def unwrap_jsonapi(body: dict) -> dict: ...
def to_project_id(body: dict) -> ProjectId: ...
def to_dataset_id(body: dict) -> DatasetId: ...
def to_table_state(body: dict, dataset_id: DatasetId) -> TableState: ...
def to_session_state(body: dict) -> SessionState: ...
def to_transform_records(body: dict) -> list[TransformRecord]: ...
def to_session_events_page(body: dict) -> tuple[list[dict], str | None, bool]:
    """Returns (events, next_cursor, has_more). Events stay as dicts because
    DomainEvents are heterogeneous and their schema lives in
    shared/chat/events.ts — out of scope to retype here."""
```

Open question §6 Q3: should `TransformRecord` be `frozen=True` and
`extra: dict` follow the SessionState pattern? Recommendation included; Mayor confirms.

#### `_http.py`

```python
def bearer(token: str, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers
```

That's the entire module. No class needed; a single utility function used by
every `*Api` constructor's `_headers` method.

#### `_api/projects.py` — `ProjectsApi`

```python
class ProjectsApi:
    def __init__(self, client: httpx.AsyncClient, *, base_url: str, token: str):
        self._client, self._base, self._token = client, base_url.rstrip("/"), token

    async def create(self, name: str) -> ProjectId:
        res = await self._client.post(
            f"{self._base}/api/projects",
            headers=bearer(self._token, json_body=True),
            content=json.dumps({"name": name}),
        )
        res.raise_for_status()
        return to_project_id(res.json())

    async def delete(self, project_id: ProjectId) -> None:
        await self._client.delete(
            f"{self._base}/api/projects/{project_id}",
            headers=bearer(self._token),
        )
```

#### `_api/uploads.py` — `UploadsApi`

```python
class UploadsApi:
    def __init__(self, client, *, base_url, token): ...

    async def upload_csv(
        self, project_id: ProjectId, csv_path: str | Path,
    ) -> DatasetId:
        path = Path(csv_path)
        with path.open("rb") as fh:
            files = {"file": (path.name, fh.read(), "text/csv")}
        res = await self._client.post(
            f"{self._base}/api/uploads",
            headers=bearer(self._token),
            files=files,
            data={"project_id": project_id},
        )
        res.raise_for_status()
        return to_dataset_id(res.json())
```

#### `_api/datasets.py` — `DatasetsApi`

```python
class DatasetsApi:
    def __init__(self, client, *, base_url, token): ...

    async def get_table_state(
        self, dataset_id: DatasetId, *, preview_limit: int = 100,
    ) -> TableState:
        res = await self._client.get(
            f"{self._base}/api/datasets/{dataset_id}",
            headers=bearer(self._token),
            params={"include_preview": "true", "preview_limit": str(preview_limit)},
        )
        res.raise_for_status()
        return to_table_state(res.json(), dataset_id)

    async def list_transforms(self, dataset_id: DatasetId) -> list[TransformRecord]:
        res = await self._client.get(
            f"{self._base}/api/datasets/{dataset_id}",
            headers=bearer(self._token),
            params={"include_transforms": "true"},
        )
        res.raise_for_status()
        return to_transform_records(res.json())
```

#### `_api/sessions.py` — `SessionsApi`

```python
class SessionsApi:
    def __init__(self, client, *, base_url, token): ...

    async def create(self, project_id: ProjectId) -> SessionState: ...

    async def list_events(
        self, session_id: SessionId, *, since: str | None = None, limit: int = 100,
    ) -> list[dict]:
        """Drains has_more in a loop and returns the full event log."""
        cursor, out = since, []
        while True:
            params: dict[str, str] = {"limit": str(limit)}
            if cursor:
                params["since"] = cursor
            res = await self._client.get(
                f"{self._base}/api/sessions/{session_id}/events",
                headers=bearer(self._token), params=params,
            )
            res.raise_for_status()
            page_events, next_cursor, has_more = to_session_events_page(res.json())
            out.extend(page_events)
            if not has_more or not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
        return out
```

#### `_api/transforms.py` — `TransformsApi`

```python
class TransformsApi:
    def __init__(self, client, *, base_url, token): ...

    async def post_direct(
        self, dataset_id: DatasetId, body: dict, *, idempotency_key: str | None = None,
    ) -> httpx.Response:
        """Returns raw httpx.Response — callers assert on status, headers, body."""
        headers = bearer(self._token, json_body=True)
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return await self._client.post(
            f"{self._base}/api/datasets/{dataset_id}/transforms",
            headers=headers, content=json.dumps(body),
        )

    async def patch_direct(self, dataset_id, body, *, idempotency_key=None) -> httpx.Response: ...
```

**Returning `httpx.Response`** is intentional — research §4 paragraph 4. The
idempotency tests assert on status code + headers + body simultaneously; mapping
through a domain dataclass would lose information. The wrapper's value is
*centralizing the URL composition + auth + Idempotency-Key construction*, not
hiding the response shape.

#### `_api/chat.py` — `ChatApi`

```python
_V6_FRAME_SEPARATOR = "\n\n"
_V6_DATA_PREFIX = "data: "
_V6_DONE_SENTINEL = "[DONE]"
_RAW_TOOL_CHUNK_TYPES = frozenset({"tool-input-start", ...})

def _parse_v6_sse(body: bytes) -> list[dict]: ...   # unchanged
def parse_chat_event_frames(body: bytes) -> tuple[list[dict], bool]: ...  # unchanged

class ChatApi:
    def __init__(
        self, client: httpx.AsyncClient, *, agent_url: str, jwt: str,
    ):
        self._client, self._agent, self._jwt = client, agent_url.rstrip("/"), jwt

    def _headers(self) -> dict[str, str]:
        # Worker authMiddleware verifies against backend JWKS only.
        return bearer(self._jwt, json_body=True)

    async def send_turn(
        self,
        prompt: str,
        *,
        project_id: ProjectId | None = None,
        dataset_id: DatasetId | None = None,
        table_schema: dict | None = None,
        thread_id: str | None = None,
    ) -> ChatEventTrace:
        body: dict[str, Any] = {
            "messages": [{"role": "user", "content": prompt}],
            "contextType": "dataset" if dataset_id else None,
        }
        if dataset_id: body["contextId"] = dataset_id
        if table_schema is not None: body["tableSchema"] = table_schema
        if project_id: body["project_id"] = project_id
        if thread_id: body["thread_id"] = thread_id
        res = await self._client.post(
            f"{self._agent}/chat", headers=self._headers(), content=json.dumps(body),
        )
        if res.status_code != 200:
            raise AssertionError(
                f"worker /chat returned {res.status_code}: {res.text[:500]}",
            )
        events, raw = parse_chat_event_frames(res.content)
        return ChatEventTrace(events=events, raw_tool_call_seen=raw)
```

`ChatApi.send_turn` is **single-turn**. No retry. No invariant check. No
`post_turn_check`. Those concerns belong on the harness facade — research §5.

#### `_api/auth.py` — token helpers (functions, not a class)

```python
async def fetch_dev_user_jwt(auth_proxy_url: str, *, code: str = "dev-auth-code") -> str: ...
async def mint_pat(auth_proxy_url: str, user_jwt: str, *, name: str, expires_in_seconds: int = 3600) -> tuple[str, str]: ...
async def revoke_pat(auth_proxy_url: str, user_jwt: str, pat_id: str) -> None: ...
```

Already module-level today; just relocate. The conftest imports them.

#### `harness.py` — slim facade

```python
from ._mappers import (
    ChatEventTrace, TableState, ProjectId, DatasetId, SessionId, SessionState,
    TransformRecord,
)
from ._api.projects import ProjectsApi
from ._api.uploads import UploadsApi
from ._api.datasets import DatasetsApi
from ._api.sessions import SessionsApi
from ._api.transforms import TransformsApi
from ._api.chat import ChatApi, parse_chat_event_frames  # re-export
from ._api.auth import fetch_dev_user_jwt, mint_pat, revoke_pat  # re-export

__all__ = [
    "DatasetLayerHarness", "TableState", "ChatEventTrace",
    "parse_chat_event_frames",  # consumed by test_harness_sse + test_wire_contract
    "fetch_dev_user_jwt", "mint_pat", "revoke_pat",
    "required_env_or_skip_reason",
]


class DatasetLayerHarness:
    def __init__(self, *, auth_proxy_url, agent_url, user_jwt, project_id=None,
                 pat=None, timeout_seconds=60.0, rephrase=None):
        self._auth_proxy_url = auth_proxy_url.rstrip("/")
        self._agent_url = agent_url.rstrip("/")
        self._user_jwt = user_jwt
        self._project_id = project_id
        self._owns_project = project_id is None
        self._pat = pat
        self._timeout = timeout_seconds
        self._rephrase = rephrase or _default_rephrase
        self._client: httpx.AsyncClient | None = None

        # Wrappers built lazily in __aenter__ once the client exists.
        self._projects: ProjectsApi | None = None
        self._uploads: UploadsApi | None = None
        self._datasets: DatasetsApi | None = None
        self._sessions: SessionsApi | None = None
        self._transforms: TransformsApi | None = None
        self._chat: ChatApi | None = None

    async def __aenter__(self) -> "DatasetLayerHarness":
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._timeout))
        backend_token = self._pat or self._user_jwt
        self._projects = ProjectsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        self._uploads = UploadsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        self._datasets = DatasetsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        self._sessions = SessionsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        self._transforms = TransformsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        self._chat = ChatApi(self._client, agent_url=self._agent_url, jwt=self._user_jwt)  # JWT-only
        if self._owns_project:
            self._project_id = await self._projects.create(f"dataset-staging-{_new_ulid_suffix()}")
        return self

    async def __aexit__(self, *_):
        try:
            if self._owns_project and self._project_id and self._projects is not None:
                await self._projects.delete(self._project_id)
        finally:
            if self._client is not None:
                await self._client.aclose()
                self._client = None

    # ---- Public API: thin delegates (signatures preserved verbatim) -----

    async def create_project(self, name: str) -> str:
        return await self._projects.create(name)

    async def upload_csv(self, csv_path, project_id=None) -> str:
        target = project_id or self._project_id
        if not target:
            raise RuntimeError(...)
        return await self._uploads.upload_csv(target, csv_path)

    async def get_table_state(self, dataset_id, *, preview_limit=100) -> TableState:
        return await self._datasets.get_table_state(dataset_id, preview_limit=preview_limit)

    async def create_session(self, project_id=None) -> dict:
        target = project_id or self._project_id
        if not target:
            raise RuntimeError(...)
        return dataclasses.asdict(await self._sessions.create(target))
        # OR: return raw dict to preserve the existing test-facing shape.
        # See open question Q1.

    async def list_session_events(self, session_id, *, since=None, limit=100) -> list[dict]:
        return await self._sessions.list_events(session_id, since=since, limit=limit)

    async def post_transforms_direct(self, dataset_id, body, *, idempotency_key=None) -> httpx.Response:
        return await self._transforms.post_direct(dataset_id, body, idempotency_key=idempotency_key)

    async def patch_transforms_direct(self, dataset_id, body, *, idempotency_key=None) -> httpx.Response:
        return await self._transforms.patch_direct(dataset_id, body, idempotency_key=idempotency_key)

    async def list_dataset_transforms(self, dataset_id) -> list[dict]:
        records = await self._datasets.list_transforms(dataset_id)
        return [dataclasses.asdict(r) for r in records]
        # OR: return raw dicts — see Q1.

    # ---- Pure assertions (no HTTP, only data) ---------------------------

    async def assert_distinct_values(self, dataset_id, column, expected: set[str]) -> None:
        state = await self._datasets.get_table_state(dataset_id, preview_limit=100)
        seen = {row[column] for row in state.preview if column in row}
        unexpected, missing = seen - expected, expected - seen
        assert not unexpected and not missing, (...)

    async def assert_no_nulls(self, dataset_id, column) -> None: ...
    async def assert_column_type(self, dataset_id, column, expected_type) -> None: ...
    async def assert_no_leading_trailing_whitespace(self, dataset_id, column) -> None: ...

    async def assert_exactly_once_via_replay(
        self, session_id, *, idempotency_key, expected_event_type,
        correlation_field="transform_id",
    ) -> dict:
        events = await self._sessions.list_events(session_id)
        matching = [
            e for e in events
            if e.get("type") == expected_event_type
            and e.get(correlation_field) == idempotency_key
        ]
        assert len(matching) == 1, (...)
        return matching[0]

    # ---- Chat orchestration (retry-with-rephrase + AC1.4 invariant) -----

    async def chat_turn(
        self, prompt, *, dataset_id=None, table_schema=None, thread_id=None,
        max_retries=2, post_turn_check=None,
    ) -> ChatEventTrace:
        attempts = max_retries + 1
        current = prompt
        last_error: AssertionError | None = None
        for attempt in range(attempts):
            trace = await self._chat.send_turn(
                current,
                project_id=self._project_id,
                dataset_id=dataset_id,
                table_schema=table_schema,
                thread_id=thread_id,
            )
            if trace.raw_tool_call_seen:
                raise AssertionError(
                    "raw Groq tool-call delta (frame prefix '9:') leaked through SSE — "
                    "AC1.4 invariant violated; the worker is no longer the single dispatcher",
                )
            if post_turn_check is None:
                return trace
            try:
                result = post_turn_check(trace)
                if asyncio.iscoroutine(result):
                    await result
                return trace
            except AssertionError as e:
                last_error = e
                if attempt + 1 < attempts:
                    current = self._rephrase(prompt, attempt + 1)
                    continue
                raise AssertionError(
                    f"chat_turn failed after {attempts} attempts (prompt={prompt!r}): {e}\n"
                    f"Last event types: {[e.get('type') for e in trace.events]!r}",
                ) from e
        assert last_error is not None
        raise last_error
```

The facade is **~280 LOC** (estimate based on existing assertion/orchestration
LOC + delegate boilerplate). All 14 public methods preserve their current
signatures. `parse_chat_event_frames`, `fetch_dev_user_jwt`, `mint_pat`,
`revoke_pat`, `required_env_or_skip_reason`, `TableState`, `ChatEventTrace` are
all importable from `harness.py` exactly as today.

### 2.3 What changes vs. today

| Concern | Before | After |
|---|---|---|
| `harness.py` LOC | 749 | ~280 |
| Number of files in `dataset_layer/` | 5 (incl. tests) | 13 (5 unchanged + 8 new) |
| Public test-facing API on `DatasetLayerHarness` | 14 methods | **14 methods, identical signatures** |
| `parse_chat_event_frames` import path | `from .harness import parse_chat_event_frames` | **same** (re-exported) |
| Token helpers (`fetch_dev_user_jwt` etc.) import path | `from .harness import fetch_dev_user_jwt` | **same** (re-exported) |
| HTTP plumbing | scattered across 13 methods | concentrated in 6 `*Api` classes |
| JSON unwrapping | inline in each method | concentrated in `_mappers.py` |
| Domain types | 2 | 5 (added `SessionState`, `TransformRecord`, three `NewType`-based id aliases) |
| `count_by` | dead code on harness | **deleted in Phase 0** (also closes `dc-grb`) |

---

## 3. Decisions baked in (justified)

### 3.1 Header builder pattern: shared `_http.py:bearer()`

Pattern A from research §9 risk 5. Single utility function. All wrappers take
`token: str` in `__init__`; build headers via `bearer(self._token, json_body=...)`.
Avoids a `BackendCredentials` value object that would be over-engineered for two
distinct token shapes.

### 3.2 `ChatApi.send_turn` is **single-turn**

Retry-with-rephrase (AC1.5) and the AC1.4 raw-tool-call check stay in the
**harness facade**. ChatApi is a transport adapter; orchestration belongs above
it. Research §5 dispatches the alternatives.

### 3.3 `TransformsApi` returns `httpx.Response`

The two transforms direct-POST/PATCH methods are exercised by C.3 idempotency
tests asserting on **status + headers + body** simultaneously. Mapping through a
domain dataclass would lose information. The wrapper's value is centralizing URL
composition, auth, and `Idempotency-Key` construction — not hiding the response.

### 3.4 `count_by` removal happens **in Phase 0**

`dc-9u1`'s commit message marks it dead; `dc-grb` tracks its removal. Removing
before the wrapper-extraction work shrinks the surface and avoids someone
copying a dead method into `DatasetsApi`. **Phase 0 is a single-commit cleanup**;
it lands independently of the rest of the refactor and unblocks `dc-grb` for
free.

### 3.5 New domain types use `frozen=True` dataclasses (except `ChatEventTrace`)

`SessionState`, `TransformRecord`, `TableState` are immutable data carriers.
`ChatEventTrace` mutates during construction (we append to its `events` list as
we parse) — leave it as-is. `NewType` aliases for ids are zero-runtime-cost type
hints.

### 3.6 No `BaseApi` superclass

Resist the urge to extract `BaseApi` with shared `__init__` boilerplate. Six
classes × four lines of constructor each is **24 lines of duplication** — well
under the threshold where DRY pays for itself. A `BaseApi` parent invites
mission creep (shared error translation, shared retry, shared logging) that
would re-couple the wrappers we just decoupled.

---

## 4. Migration plan in phases

Five phases, each independently shippable. The integration suite stays green at
every phase boundary. **One bead per phase**, mirroring the Stream.io epic
(Mayor's confirmed convention).

### Phase 0 — Drop `count_by` (closes `dc-grb`)

1. Delete `count_by` (lines 384–399 in `harness.py`).
2. No test consumers (verified by grep).
3. Update `dc-grb` to closed status.

**Bead size:** trivial. ~15 LOC removed. Could be folded into Phase 1 or stand
alone — recommend stand-alone so `dc-grb` closes on its own commit and the
diff stays clean.

### Phase 1 — Extract mappers + `_http.py`

1. **RED:** add a small `tests/unit/test_mappers.py` covering `unwrap_jsonapi`,
   `to_project_id`, `to_dataset_id`, `to_table_state`, `to_session_state`,
   `to_transform_records`, `to_session_events_page`. Pure data-shape tests, no
   HTTP. (These are characterization tests for the existing inline behavior —
   write them by reading the harness's current tolerant-unwrapping logic and
   pinning the same outputs.)
2. **GREEN:**
   - Create `_mappers.py` with the dataclasses + new `NewType` aliases + the
     mapping functions (research §4).
   - Create `_http.py` with `bearer(token, *, json_body=False)`.
   - Update `harness.py` to import `TableState`, `ChatEventTrace`,
     `unwrap_jsonapi` etc. from `_mappers.py` and `bearer` from `_http.py`.
   - The existing methods still call `self._client.post(...)` directly; only
     the unwrapping is delegated.
3. **GREEN gate:** `npm run test:all` (or scoped: `cd backend && uv run pytest
   tests/integration/dataset_layer/`) passes.

**Bead size:** medium. ~150 LOC moved + ~80 LOC of unit tests. No behavior
change.

### Phase 2 — Extract `*Api` wrappers (one PR, sequential commits inside)

Six wrappers + auth helpers. Doable in one bead because each extraction is
independent and the test surface stays stable. Inside the bead, **commit per
wrapper** so bisect remains cheap if something regresses:

1. `_api/auth.py` (relocate the 3 token helpers; re-export from `harness.py`).
2. `_api/projects.py` + facade rewires `create_project` and `__aexit__`.
3. `_api/uploads.py` + facade rewires `upload_csv`.
4. `_api/datasets.py` + facade rewires `get_table_state` and
   `list_dataset_transforms`.
5. `_api/sessions.py` + facade rewires `create_session` and
   `list_session_events`.
6. `_api/transforms.py` + facade rewires `post_transforms_direct` and
   `patch_transforms_direct`.
7. `_api/chat.py` (parser + ChatApi.send_turn) + facade re-exports
   `parse_chat_event_frames` + facade rewires `chat_turn` to call
   `self._chat.send_turn(...)` while keeping the retry loop and AC1.4 check
   in place.

**Each commit runs the integration suite.** If a step fails, fix that step
before continuing.

**Bead size:** large but safe. ~470 LOC moved out of `harness.py`, ~470 LOC
distributed across 7 new files. No public API changes.

### Phase 3 — Slim facade + audit

1. Delete the now-unused private methods (`_drive_one_turn`, `_backend_headers`,
   `_agent_headers`, `_require_client` if no longer called).
2. Tidy imports.
3. Confirm `harness.py` LOC is in the ~280 range; investigate if it's
   significantly higher.
4. Confirm the `__all__` list exports the back-compat surface
   (research §3 hard constraint): `parse_chat_event_frames`,
   `fetch_dev_user_jwt`, `mint_pat`, `revoke_pat`, `required_env_or_skip_reason`,
   `TableState`, `ChatEventTrace`.

**Bead size:** small. ~50 LOC removed. Mostly a janitorial sweep.

### Phase 4 — Documentation

1. Update `docs/evolution/2026-05-01-api-driven-user-flow-tests.md` §7 to
   reflect the new structure (the old §7 documented the monolithic harness
   shape; it needs to mention the wrapper modules now).
2. Run `/nw-finalize` on this design doc — migrates it from `docs/feature/` to
   `docs/evolution/2026-05-XX-refactor-dataset-layer-harness.md`.
3. Optionally write a short ADR documenting the per-API-wrapper-vs-monolithic
   decision (informal note: the dc-4dp roadmap chose monolithic; the decision
   record explains why we redirected). **Recommend skipping** unless Mayor wants
   the artifact — the design doc + git history are sufficient for a
   test-infrastructure refactor of this scope.

**Bead size:** trivial.

### 4.1 Phase ordering rationale

- **Phase 0 is independent** of everything else; ships whenever.
- **Phase 1 must precede Phase 2** because Phase 2 wrappers depend on the
  mapper functions and the `bearer` helper.
- **Phase 2 commits are sequential within one bead** — each commit keeps the
  integration suite green, so a polecat can pause between any pair of commits.
- **Phase 3 must follow Phase 2** because the methods it deletes are referenced
  by code Phase 2 deletes.
- **Phase 4 follows landing** — documentation reflects what shipped.

---

## 5. Acceptance criteria

These belong on the polecat's roadmap (not this design doc), but listing here
so Mayor can sanity-check before invoking `/nw-roadmap`:

1. **Public API stability:** every method named in research §6 still exists on
   `DatasetLayerHarness` with the same parameter list and return type.
2. **Import-path stability:** `from
   backend.tests.integration.dataset_layer.harness import
   parse_chat_event_frames` still works (covers `test_harness_sse.py` and
   `test_wire_contract.py`).
3. **Module-level helpers stability:** `fetch_dev_user_jwt`, `mint_pat`,
   `revoke_pat`, `required_env_or_skip_reason` remain importable from
   `harness.py`.
4. `harness.py` LOC drops from 749 to ≤ 320 (allow 15 % padding on the ~280
   estimate).
5. No new file exceeds 100 LOC except `_api/chat.py` (which carries the SSE
   parser + constants).
6. Integration suite is green: `cd backend && uv run pytest
   tests/integration/dataset_layer/` passes (when compose stack is up).
7. Unit tests added in Phase 1 pin the mapper behavior independently of the
   compose stack: `cd backend && uv run pytest
   tests/unit/test_mappers.py` passes.
8. `count_by` is gone from the codebase; `dc-grb` closed.

---

## 6. Open questions for Mayor

1. **`create_session` and `list_dataset_transforms` return shape.** Today they
   return `dict` and `list[dict]`. The decomposition produces typed
   `SessionState` and `list[TransformRecord]` from the wrapper layer. Two
   options for the facade:
    - **6.1a (recommended):** facade returns `dict` / `list[dict]` to preserve
      the test-facing surface verbatim, converting via `dataclasses.asdict(...)`
      at the boundary. Zero churn for test consumers; slight repeat work
      converting back to dict.
    - 6.1b: facade returns the dataclass; update the tests to `state.id` /
      `record.kind` etc. Cleaner long-term, but pulls test-file edits into the
      refactor scope and breaks the §6 acceptance criterion #1.
   **Pick:** 6.1a. The internal mappers exist for the wrapper layer's benefit;
   the facade preserves the test API. If we later want typed access across the
   full surface, that's a separate, opt-in epic.
2. **`_default_rephrase` location.** Lives at module scope in `harness.py`
   today. After extraction, it could move to `_api/chat.py` (the chat surface)
   or stay in `harness.py` (it's chat-orchestration policy, which we already
   placed on the facade). **Recommend:** stay in `harness.py`. Mirrors the
   facade-owns-orchestration decision (§3.2).
3. **Frozen `TransformRecord` and `extra: dict`?** Research §4 includes
   `created_at` as `str | None` because it's surfaced inconsistently by the
   backend. Should `TransformRecord` carry an `extra: dict` like
   `SessionState` for forward-compat? **Recommend:** yes. Cheap insurance, and
   matches the SessionState pattern.
4. **One bead for all of Phase 2 vs. one bead per wrapper?** Mayor's Stream.io
   convention is "one bead per phase." Phase 2 here has 7 internal commits.
   Sub-question: does Mayor want a single Phase 2 bead with sequenced commits,
   or 7 micro-beads? **Recommend:** single bead — the wrappers don't merit
   independent rollback, and 7 sequential beads add ceremony without buying
   bisect resolution that the in-bead commit history already provides.
5. **ADR or no ADR?** No architectural pivot here — just a structural
   refactor of test infrastructure. **Recommend:** no ADR; design doc + git
   history are sufficient. Open to override if Mayor wants the formal record.

---

## 7. Risks (carried forward from research)

| Risk | Mitigation |
|---|---|
| Refactoring tests is dangerous when tests ARE the regression net | Public API preserved verbatim; integration suite green at every phase boundary; commits within Phase 2 are individually bisectable |
| `parse_chat_event_frames` import-path break | Re-export in `harness.py:__all__`; Phase 2 step 7 explicitly verifies the re-export works |
| Token-helper import-path break | Same — re-exported |
| Mapper unit tests drift from real-API responses | Phase 1 tests are characterization tests, not contract tests; the integration suite remains the contract gate |
| Header-builder duplication grows | Shared `_http.bearer(...)` (§3.1) prevents this |
| Someone copies dead `count_by` into `DatasetsApi` | Phase 0 deletes it before Phase 2 starts |

---

## 8. Out of scope

Explicitly **not** in this epic:

1. **Changing harness public API signatures.** Any signature change is
   structural-correctness work and goes through a separate decision.
2. **Retyping DomainEvents** in `list_session_events`. The events are
   heterogeneous and their schema lives in `shared/chat/events.ts` — out of
   scope to retype here. List remains `list[dict[str, Any]]`.
3. **Adding new test coverage** beyond the Phase 1 mapper-characterization
   tests. The integration suite is the contract gate; do not expand it during
   refactor.
4. **Integration with the auth-proxy** beyond what's already wired. The
   harness's auth shape (PAT for backend GETs, JWT for worker SSE) is correct
   and unchanged.
5. **Bazel BUILD-file restructuring.** Adding 8 new `.py` files under
   `backend/tests/integration/dataset_layer/` shouldn't require BUILD-file
   surgery if the existing target globs the directory. **Verify this in
   Phase 0** — if it doesn't, BUILD updates become a Phase 1 prerequisite.
6. **Switching from `httpx.AsyncClient` to anything else.** Unchanged.
7. **Changing `_default_rephrase` behavior.** Mechanical relocation only.

---

## 9. Hand-off

Mayor reviews → answers open questions → invokes `/nw-roadmap` per phase →
polecat executes via `/nw-deliver` per phase. Sequenced (Phase 0 → 1 → 2 → 3 →
4) with the integration suite green at each boundary.
