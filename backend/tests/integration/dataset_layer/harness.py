"""DatasetLayerHarness — drives the dataset (staging) layer over the API.

Implements the harness shape defined in
``docs/evolution/2026-05-01-api-driven-user-flow-tests.md`` §7. The harness
runs against a real compose stack (auth-proxy + backend + worker +
query-engine + MinIO per ADR-016) and consumes the worker's typed
``ChatEvent`` SSE vocabulary (see ``shared/chat/events.ts``).

Auth shape
----------

Per ADR-016, all ingress to backend and worker routes through the auth-proxy
in production. The harness mirrors that:

* A backend-issued dev JWT (RS256) is obtained from
  ``POST {auth-proxy}/api/auth/callback`` (public path; in dev mode the
  provider returns ``DEV_USER`` + a freshly minted JWT). This JWT is what
  the harness sends to the worker ``/chat`` endpoint, because the worker's
  middleware verifies tokens against the backend JWKS only.
* A PAT is minted at session-fixture time via
  ``POST {auth-proxy}/api/auth/pats`` to exercise the headless-tokens flow
  (``docs/guides/headless-tokens.md``). The PAT is used for at least one
  backend GET to prove issuance + verification + revocation work end-to-end
  through the auth-proxy. Worker calls continue to use the dev JWT because
  the worker does not (yet) trust auth-proxy-minted PATs.

LLM determinism
---------------

The harness implements the AC1.5 retry-with-rephrase budget: each
``chat_turn`` accepts a ``max_retries`` (default 2) and a ``rephrase``
callable. On post-turn assertion failure, the prompt is rephrased and the
chat is retried. Pinning model + temperature is a worker-side concern (env
vars on the agent container).
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import secrets
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any, NewType

import httpx

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------
#
# Phase 1 (dc-wcy.5) introduces the typed identifier aliases and the new
# ``SessionState`` / ``TransformRecord`` data carriers inline per Mayor's scope
# override (no new files). The pre-existing ``TableState`` and
# ``ChatEventTrace`` remain unchanged. See ``docs/feature/refactor-dataset-
# layer-harness/design/design.md`` §2.2.

ProjectId = NewType("ProjectId", str)
DatasetId = NewType("DatasetId", str)
SessionId = NewType("SessionId", str)


@dataclasses.dataclass
class ChatEventTrace:
    """The bag of typed ChatEvents observed during a single chat_turn."""

    events: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    raw_tool_call_seen: bool = False  # AC1.4 invariant flag

    def of_type(self, event_type: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e.get("type") == event_type]

    @property
    def turn_done(self) -> dict[str, Any] | None:
        done = self.of_type("turn_done")
        return done[-1] if done else None


@dataclasses.dataclass
class TableState:
    """A point-in-time view of a dataset's table state via the backend API."""

    dataset_id: str
    row_count: int
    columns: list[dict[str, Any]]
    preview: list[dict[str, Any]]

    def column_type(self, column: str) -> str | None:
        for c in self.columns:
            if c.get("name") == column or c.get("id") == column:
                return c.get("type")
        return None


@dataclasses.dataclass(frozen=True)
class SessionState:
    """Typed view of a session resource returned by ``POST /api/projects/{id}/sessions``.

    ``id`` is the session id used for ``GET /api/sessions/{id}/events``;
    ``stream_thread_id`` is the worker thread id the agent persists to (the
    ``RedisSessionEventReader`` keys its stream by it). Non-essential fields
    survive in ``extra`` for forward-compat without re-typing every backend
    addition here.
    """

    id: str
    stream_thread_id: str
    extra: dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass(frozen=True)
class TransformRecord:
    """Typed view of one entry in ``GET /api/datasets/{id}?include_transforms=true``.

    Fields mirror the bead's typed-mapper design (§2.2). ``created_at`` is
    optional because the backend surfaces it inconsistently. Non-essential
    fields survive in ``extra`` for forward-compat.
    """

    id: str
    kind: str
    params: dict[str, Any]
    created_at: str | None = None
    extra: dict[str, Any] = dataclasses.field(default_factory=dict)


# ---------------------------------------------------------------------------
# HTTP helpers (dc-wcy.5 — inline per Mayor scope override)
# ---------------------------------------------------------------------------
#
# Single-purpose Bearer-header builder used by the harness's ``_backend_headers``
# / ``_agent_headers`` and (in Phase 2) by the per-API wrapper classes. Centralizing
# this here avoids the same ``{"Authorization": f"Bearer {token}"}`` literal
# scattered across each future wrapper's constructor. Design ref §3.1.


def bearer(token: str, *, json_body: bool = False) -> dict[str, str]:
    """Return a fresh dict with ``Authorization: Bearer <token>``.

    When ``json_body=True`` also sets ``Content-Type: application/json`` for
    request bodies. Each call returns a new dict so callers may safely mutate
    (e.g. to add ``Idempotency-Key``).
    """
    headers = {"Authorization": f"Bearer {token}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


# ---------------------------------------------------------------------------
# Mappers (dc-wcy.5 — inline per Mayor scope override; design §2.2)
# ---------------------------------------------------------------------------
#
# Tolerant unwrappers that translate raw backend JSON bodies into the typed
# data carriers above. These are pure functions: no HTTP, no I/O, no shared
# state. They live inline in this module for Phase 1; Phase 2 will lift them
# into per-API wrapper classes.


def unwrap_jsonapi(body: Any) -> dict[str, Any]:
    """Flatten a JSON:API single-resource envelope to ``{id, **attributes}``.

    Tolerates already-flat responses: if ``data`` isn't a JSON:API resource
    object (no ``attributes`` field), returns it unchanged. Older endpoints
    that don't envelope at all also pass through. Non-dict bodies (or a
    non-dict ``data`` entry, e.g. a JSON:API collection) return ``{}`` so
    downstream mappers can defensively ``body.get(...)``.
    """
    if not isinstance(body, dict):
        return {}
    data = body.get("data", body)
    if isinstance(data, dict) and isinstance(data.get("attributes"), dict):
        return {"id": data.get("id"), **data["attributes"]}
    return data if isinstance(data, dict) else {}


def to_project_id(body: dict[str, Any]) -> ProjectId:
    """Extract the project id from ``POST /api/projects`` response.

    Tolerates both flat ``{id, ...}`` and ``{data: {id, ...}}`` shapes.
    """
    if isinstance(body.get("data"), dict):
        body = body["data"]
    pid = body.get("id")
    if not isinstance(pid, str):
        raise RuntimeError(f"create_project: no id in response body: {body!r}")
    return ProjectId(pid)


def to_dataset_id(body: dict[str, Any]) -> DatasetId:
    """Extract the dataset id from ``POST /api/uploads`` response.

    Prefers ``id`` over the legacy ``dataset_id`` field; tolerates ``data``
    envelope.
    """
    if isinstance(body.get("data"), dict):
        body = body["data"]
    did = body.get("id") or body.get("dataset_id")
    if not isinstance(did, str):
        raise RuntimeError(f"upload_csv: no dataset id in response body: {body!r}")
    return DatasetId(did)


def to_table_state(body: dict[str, Any], dataset_id: str) -> TableState:
    """Build a ``TableState`` from ``GET /api/datasets/{id}?include_preview=true``.

    Tolerates JSON:API envelopes, the legacy ``preview_rows`` alias, columns
    nested under ``schema.columns``, and missing row counts (falls back to
    ``rows`` and finally ``len(preview)``).
    """
    data = unwrap_jsonapi(body)
    preview = data.get("preview") or data.get("preview_rows") or []
    columns = data.get("columns") or data.get("schema", {}).get("columns") or []
    row_count = data.get("row_count") or data.get("rows") or len(preview)
    return TableState(
        dataset_id=dataset_id,
        row_count=int(row_count) if row_count is not None else 0,
        columns=columns,
        preview=preview,
    )


def to_session_state(body: dict[str, Any]) -> SessionState:
    """Build a ``SessionState`` from ``POST /api/projects/{id}/sessions`` response.

    Surfaces ``id`` and ``stream_thread_id`` as typed fields and stashes
    everything else in ``extra``.
    """
    data = unwrap_jsonapi(body)
    sid = data.get("id")
    if not isinstance(sid, str):
        raise RuntimeError(f"create_session: no id in response body: {body!r}")
    stream_thread_id = data.get("stream_thread_id") or ""
    extra = {k: v for k, v in data.items() if k not in ("id", "stream_thread_id")}
    return SessionState(id=sid, stream_thread_id=stream_thread_id, extra=extra)


def to_transform_records(body: dict[str, Any]) -> list[TransformRecord]:
    """Build typed transform records from ``GET /api/datasets/{id}?include_transforms=true``.

    Returns ``[]`` when no transforms are present. Each record's non-essential
    fields land in ``extra``.
    """
    data = unwrap_jsonapi(body)
    raw = data.get("transforms") or []
    records: list[TransformRecord] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        records.append(
            TransformRecord(
                id=str(item.get("id", "")),
                kind=str(item.get("kind", "")),
                params=dict(item.get("params") or {}),
                created_at=item.get("created_at") if isinstance(item.get("created_at"), str) else None,
                extra={k: v for k, v in item.items() if k not in ("id", "kind", "params", "created_at")},
            ),
        )
    return records


def to_session_events_page(
    body: dict[str, Any],
) -> tuple[list[dict[str, Any]], str | None, bool]:
    """Decompose one page of ``GET /api/sessions/{id}/events`` into (events, cursor, has_more).

    Events stay as ``dict`` because DomainEvents are heterogeneous and their
    schema lives in ``shared/chat/events.ts`` — out of scope to retype here
    (design §2.2 / §8.2).
    """
    events = body.get("events") or []
    next_cursor = body.get("next_cursor") if isinstance(body.get("next_cursor"), str) else None
    has_more = bool(body.get("has_more"))
    return list(events), next_cursor, has_more


# ---------------------------------------------------------------------------
# SSE frame parser (AI SDK v6 UIMessage data-stream format)
# ---------------------------------------------------------------------------
#
# The agent serializes its UIMessageChunk stream via
# ``JsonToSseTransformStream``, producing v6 frames of the shape::
#
#     data: {"type":"text-delta","id":"...","delta":"..."}\n\n
#     data: {"type":"data-chat-event","id":"...","data":{<ChatEvent>}}\n\n
#     data: {"type":"data-agent-request","id":"...","data":{<AgentRequest>}}\n\n
#     data: {"type":"finish","finishReason":"stop",...}\n\n
#     data: [DONE]\n\n
#
# ChatEvents reach the harness via ``data-chat-event`` typed parts (the
# canonical v6 channel), with the ChatEvent shape carried under
# ``payload['data']``. Raw Groq tool-call deltas are stripped upstream by
# the agent's ``pipeChatStream`` and translated into typed ``data-chat-event``
# parts; if any survive (chunk type ``tool-input-delta`` or similar) we surface
# that as ``raw_tool_call_seen`` to keep AC1.4 enforceable end-to-end.
#
# Reference parsers (TypeScript, identical contract):
# - ``frontend/src/core/chat/services/chatStream.ts``
# - ``agent/test/chat/_v6Mocks.ts``


_V6_FRAME_SEPARATOR = "\n\n"
_V6_DATA_PREFIX = "data: "
_V6_DONE_SENTINEL = "[DONE]"
_RAW_TOOL_CHUNK_TYPES = frozenset(
    {
        "tool-input-start",
        "tool-input-delta",
        "tool-input-available",
        "tool-output-available",
    },
)


def _parse_v6_sse(body: bytes) -> list[dict[str, Any]]:
    """Decode a v6 SSE byte stream into a list of UIMessageChunk-shaped dicts.

    Frames are ``data: <json>\\n\\n``. Non-data lines, the ``[DONE]`` sentinel,
    and malformed JSON payloads are tolerated and skipped.
    """
    text = body.decode("utf-8", errors="replace")
    chunks: list[dict[str, Any]] = []
    for raw_frame in text.split(_V6_FRAME_SEPARATOR):
        frame = raw_frame.strip()
        if not frame or not frame.startswith(_V6_DATA_PREFIX):
            continue
        payload_text = frame[len(_V6_DATA_PREFIX) :].strip()
        if not payload_text or payload_text == _V6_DONE_SENTINEL:
            continue
        try:
            payload = json.loads(payload_text)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and isinstance(payload.get("type"), str):
            chunks.append(payload)
    return chunks


def parse_chat_event_frames(body: bytes) -> tuple[list[dict[str, Any]], bool]:
    """Parse the AI SDK v6 SSE body into (events, raw_tool_call_seen).

    Surfaces the ``data`` payload of every ``data-chat-event`` typed part as
    a ChatEvent dict. Sets ``raw_tool_call_seen`` if any unstripped raw
    tool-call chunk leaks through the SSE — that would mean the agent's
    ``pipeChatStream`` is no longer the single dispatcher, violating AC1.4.
    """
    events: list[dict[str, Any]] = []
    raw_tool_call_seen = False
    for chunk in _parse_v6_sse(body):
        chunk_type = chunk.get("type")
        if chunk_type == "data-chat-event":
            data = chunk.get("data")
            if isinstance(data, dict) and isinstance(data.get("type"), str):
                events.append(data)
        elif chunk_type in _RAW_TOOL_CHUNK_TYPES:
            raw_tool_call_seen = True
    return events, raw_tool_call_seen


# ---------------------------------------------------------------------------
# Per-API wrapper classes (dc-wcy.6 — inline per Mayor scope override; design §4 Phase 2)
# ---------------------------------------------------------------------------
#
# Per the Mayor's scope override, all wrapper classes live above the facade in
# this module — no ``_api/`` package, no separate files. Each wrapper centralizes
# URL composition + auth header construction for one endpoint family. The
# facade (``DatasetLayerHarness``) composes wrappers via DI in ``__aenter__``.


class AuthApi:
    """Auth-proxy token helpers grouped as a class wrapper (design §4 Phase 2).

    The three operations — fetching a backend dev JWT, minting a PAT, revoking
    a PAT — are stateless module-level concerns called outside the harness
    lifecycle (typically from conftest fixtures before the harness exists).
    Implemented as ``@staticmethod`` so callers can use either the class
    methods or the module-level re-exports below; conftest's existing
    ``from .harness import fetch_dev_user_jwt, mint_pat, revoke_pat`` keeps
    working unchanged.
    """

    @staticmethod
    async def fetch_dev_user_jwt(auth_proxy_url: str, *, code: str = "dev-auth-code") -> str:
        """Obtain a backend-issued dev JWT via the public callback endpoint.

        In ``AUTH_MODE=dev``, ``DevAuthProvider.handle_callback`` returns
        ``DEV_USER`` + a freshly minted RS256 JWT regardless of the supplied
        code. The auth-proxy whitelists ``/api/auth/callback`` so this works
        without prior auth.
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{auth_proxy_url.rstrip('/')}/api/auth/callback",
                json={"code": code},
            )
            res.raise_for_status()
            body = res.json()
        token = body.get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError(f"callback did not return a token: {body!r}")
        return token

    @staticmethod
    async def mint_pat(
        auth_proxy_url: str,
        user_jwt: str,
        *,
        name: str = "dataset-layer-harness",
        expires_in_seconds: int = 3600,
    ) -> tuple[str, str]:
        """Mint a PAT via auth-proxy. Returns (pat_id, token).

        Exercises the headless-tokens flow end-to-end (issuance + signing).
        Caller is responsible for revocation; the harness conftest revokes at
        session end.
        """
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{auth_proxy_url.rstrip('/')}/api/auth/pats",
                headers=bearer(user_jwt, json_body=True),
                content=json.dumps({"name": name, "expires_in_seconds": expires_in_seconds}),
            )
            res.raise_for_status()
            body = res.json()
        pat_id = body.get("id")
        token = body.get("token")
        if not isinstance(pat_id, str) or not isinstance(token, str):
            raise RuntimeError(f"PAT issuance returned unexpected shape: {body!r}")
        return pat_id, token

    @staticmethod
    async def revoke_pat(auth_proxy_url: str, user_jwt: str, pat_id: str) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 404 is acceptable: e.g., already revoked / unknown id.
            await client.delete(
                f"{auth_proxy_url.rstrip('/')}/api/auth/pats/{pat_id}",
                headers=bearer(user_jwt),
            )


class ProjectsApi:
    """Backend ``/api/projects`` wrapper (design §2.2).

    Owns POST (create) and DELETE (cleanup). The facade composes one in
    ``__aenter__`` using the backend token (PAT or dev JWT) and delegates
    ``create_project`` + project teardown to it.
    """

    def __init__(self, client: httpx.AsyncClient, *, base_url: str, token: str):
        self._client = client
        self._base = base_url.rstrip("/")
        self._token = token

    async def create(self, name: str) -> ProjectId:
        res = await self._client.post(
            f"{self._base}/api/projects",
            headers=bearer(self._token, json_body=True),
            content=json.dumps({"name": name}),
        )
        res.raise_for_status()
        return to_project_id(res.json())

    async def delete(self, project_id: str) -> None:
        await self._client.delete(
            f"{self._base}/api/projects/{project_id}",
            headers=bearer(self._token),
        )


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


def _new_ulid_suffix() -> str:
    """Return a 13-character lowercase base32 random suffix.

    Crockford-base32 ULIDs are 26 chars (48 timestamp bits + 80 random); for
    the per-test project key we only need uniqueness, not lexicographic
    sortability, so a stripped random tail suffices and avoids a new
    runtime dependency.
    """
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
    return "".join(alphabet[b % 32] for b in secrets.token_bytes(13))


class DatasetLayerHarness:
    """Headless API driver for the dataset (staging) layer.

    The public surface matches design.md §7 verbatim:

        async def __aenter__(self): ...
        async def __aexit__(self, *_): ...
        async def create_project(name): -> str
        async def upload_csv(project_id, csv_path): -> str
        async def chat_turn(prompt, *, max_retries=2): -> ChatEventTrace
        async def get_table_state(dataset_id): -> TableState
        async def assert_distinct_values(dataset_id, column, expected: set[str])
        async def assert_no_nulls(dataset_id, column)
        async def assert_column_type(dataset_id, column, expected_type)

    A pre-existing project_id may be passed in (e.g. from a fixture that
    handles ULID-keyed teardown); otherwise the harness creates one inside
    ``__aenter__`` and tears it down on exit.
    """

    def __init__(
        self,
        *,
        auth_proxy_url: str,
        agent_url: str,
        user_jwt: str,
        project_id: str | None = None,
        pat: str | None = None,
        timeout_seconds: float = 60.0,
        rephrase: Callable[[str, int], str] | None = None,
    ):
        self._auth_proxy_url = auth_proxy_url.rstrip("/")
        self._agent_url = agent_url.rstrip("/")
        self._user_jwt = user_jwt
        self._project_id = project_id
        self._owns_project = project_id is None
        self._pat = pat
        self._timeout = timeout_seconds
        self._rephrase = rephrase or _default_rephrase
        self._client: httpx.AsyncClient | None = None
        # Wrappers built lazily in __aenter__ once the client exists (design §2.2).
        self._projects: ProjectsApi | None = None

    # ----- lifecycle --------------------------------------------------------

    async def __aenter__(self) -> DatasetLayerHarness:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._timeout))
        backend_token = self._pat or self._user_jwt
        self._projects = ProjectsApi(self._client, base_url=self._auth_proxy_url, token=backend_token)
        if self._owns_project:
            self._project_id = await self.create_project(f"dataset-staging-{_new_ulid_suffix()}")
        return self

    async def __aexit__(self, *_: object) -> None:
        try:
            if self._owns_project and self._project_id and self._projects is not None:
                await self._projects.delete(self._project_id)
        finally:
            if self._client is not None:
                await self._client.aclose()
                self._client = None
                self._projects = None

    # ----- public API -------------------------------------------------------

    async def create_project(self, name: str) -> str:
        """Create a project via auth-proxy → backend; return its id."""
        if self._projects is None:
            raise RuntimeError(
                "DatasetLayerHarness must be used as an async context manager (`async with`)",
            )
        return await self._projects.create(name)

    async def upload_csv(self, csv_path: str | Path, project_id: str | None = None) -> str:
        """Upload a CSV via the backend ``/api/uploads`` endpoint; return dataset_id."""
        target_project = project_id or self._project_id
        if not target_project:
            raise RuntimeError("upload_csv: no project_id; pass one or initialize the harness with one")
        client = self._require_client()
        path = Path(csv_path)
        with path.open("rb") as fh:
            files = {"file": (path.name, fh.read(), "text/csv")}
        res = await client.post(
            f"{self._auth_proxy_url}/api/uploads",
            headers=self._backend_headers(),
            files=files,
            data={"project_id": target_project},
        )
        res.raise_for_status()
        return to_dataset_id(res.json())

    async def chat_turn(
        self,
        prompt: str,
        *,
        dataset_id: str | None = None,
        table_schema: dict[str, Any] | None = None,
        thread_id: str | None = None,
        max_retries: int = 2,
        post_turn_check: Callable[[ChatEventTrace], Awaitable[None] | None] | None = None,
    ) -> ChatEventTrace:
        """Drive one chat turn end-to-end.

        Sends ``prompt`` to the worker ``/chat`` endpoint, parses the SSE
        stream into a ``ChatEventTrace``, waits for ``turn_done`` (or stream
        close), then runs ``post_turn_check`` if supplied. Retries with a
        rephrased prompt up to ``max_retries`` times if the check raises
        AssertionError. Per AC1.5 the default budget is 2.
        """
        attempts = max_retries + 1
        last_error: AssertionError | None = None
        current = prompt
        for attempt in range(attempts):
            trace = await self._drive_one_turn(
                current,
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
        # Unreachable but keeps the type checker honest:
        assert last_error is not None
        raise last_error

    async def get_table_state(self, dataset_id: str, *, preview_limit: int = 100) -> TableState:
        client = self._require_client()
        res = await client.get(
            f"{self._auth_proxy_url}/api/datasets/{dataset_id}",
            headers=self._backend_headers(),
            params={"include_preview": "true", "preview_limit": str(preview_limit)},
        )
        res.raise_for_status()
        return to_table_state(res.json(), dataset_id)

    async def assert_distinct_values(self, dataset_id: str, column: str, expected: set[str]) -> None:
        state = await self.get_table_state(dataset_id, preview_limit=100)
        seen = {row[column] for row in state.preview if column in row}
        unexpected = seen - expected
        missing = expected - seen
        assert not unexpected and not missing, (
            f"distinct values mismatch for column={column!r}: "
            f"expected={sorted(expected)!r} got={sorted(seen)!r} "
            f"unexpected={sorted(unexpected)!r} missing={sorted(missing)!r}"
        )

    async def assert_no_nulls(self, dataset_id: str, column: str) -> None:
        state = await self.get_table_state(dataset_id, preview_limit=100)
        offenders = [row for row in state.preview if row.get(column) in (None, "")]
        assert not offenders, f"column {column!r} still has null/empty values after expected fill: {offenders[:3]!r}"

    async def assert_column_type(self, dataset_id: str, column: str, expected_type: str) -> None:
        state = await self.get_table_state(dataset_id)
        actual = state.column_type(column)
        assert actual == expected_type, f"column {column!r} type mismatch: expected {expected_type!r} got {actual!r}"

    async def assert_no_leading_trailing_whitespace(self, dataset_id: str, column: str) -> None:
        state = await self.get_table_state(dataset_id, preview_limit=100)
        offenders = [
            row[column]
            for row in state.preview
            if isinstance(row.get(column), str) and row[column] != row[column].strip()
        ]
        assert not offenders, f"column {column!r} still has leading/trailing whitespace: {offenders[:5]!r}"

    # ----- replay + idempotency surfaces (G.2) ------------------------------

    async def create_session(self, project_id: str | None = None) -> dict[str, Any]:
        """Create a session in the project; return its dict.

        The returned dict carries both ``id`` (used by ``GET /api/sessions/{id}/events``)
        and ``stream_thread_id`` (the worker ``thread_id`` the agent persists
        to). The ``RedisSessionEventReader`` keys its stream by
        ``stream_thread_id``, so the test must pass the same value to
        ``chat_turn(thread_id=...)`` for replay assertions to find anything.
        """
        target_project = project_id or self._project_id
        if not target_project:
            raise RuntimeError("create_session: no project_id; pass one or initialize the harness with one")
        client = self._require_client()
        res = await client.post(
            f"{self._auth_proxy_url}/api/projects/{target_project}/sessions",
            headers=self._backend_headers(json_body=True),
            content=json.dumps({}),
        )
        res.raise_for_status()
        body = res.json()
        data = unwrap_jsonapi(body)
        if not isinstance(data, dict) or "id" not in data:
            raise RuntimeError(f"create_session: unexpected response shape: {body!r}")
        # Phase 1 (dc-wcy.5): the typed ``to_session_state`` mapper is
        # introduced + tested; the facade keeps the test-facing ``dict``
        # surface verbatim. Phase 2 will wire ``SessionState`` through.
        return data

    async def list_session_events(
        self,
        session_id: str,
        *,
        since: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Page through ``GET /api/sessions/{id}/events`` and return all events.

        Drains ``has_more`` so a single call returns the full event log for the
        session (limit per page is 100; sessions in tests stay well under
        a few pages). The replay endpoint filters out UI directives by
        contract — only DomainEvents come back.
        """
        client = self._require_client()
        cursor = since
        out: list[dict[str, Any]] = []
        while True:
            params: dict[str, str] = {"limit": str(limit)}
            if cursor:
                params["since"] = cursor
            res = await client.get(
                f"{self._auth_proxy_url}/api/sessions/{session_id}/events",
                headers=self._backend_headers(),
                params=params,
            )
            res.raise_for_status()
            page_events, next_cursor, has_more = to_session_events_page(res.json())
            out.extend(page_events)
            if not has_more or not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
        return out

    async def assert_exactly_once_via_replay(
        self,
        session_id: str,
        *,
        idempotency_key: str,
        expected_event_type: str,
        correlation_field: str = "transform_id",
    ) -> dict[str, Any]:
        """Bead-spec'd cross-product helper for C.2 (replay) x C.3 (idempotency).

        Asserts the session's replay stream contains exactly ONE event of
        ``expected_event_type`` whose ``correlation_field`` equals
        ``idempotency_key``. Returns the matching event for further assertions.

        Architectural note: ``transform_applied`` events do not carry the
        backend ``Idempotency-Key`` header value directly. The agent emits
        them with a ``transform_id`` (the id returned by the idempotent
        backend POST), and a retry under C.3 returns the same id from the
        cache — so ``transform_id`` is the stable correlation token between
        an idempotent request and its replay-visible event. Callers pass
        that token as ``idempotency_key`` here. ``correlation_field`` is
        overridable for non-transform domain events that may surface in the
        future (e.g., ``row_id`` for a ``row_added`` event).
        """
        events = await self.list_session_events(session_id)
        matching = [
            e for e in events if e.get("type") == expected_event_type and e.get(correlation_field) == idempotency_key
        ]
        assert len(matching) == 1, (
            f"replay stream did not show exactly ONE {expected_event_type!r} for "
            f"{correlation_field}={idempotency_key!r}: got {len(matching)} matches. "
            f"All event types in stream: {[e.get('type') for e in events]!r}"
        )
        return matching[0]

    async def post_transforms_direct(
        self,
        dataset_id: str,
        body: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        """Direct POST to ``/api/datasets/{id}/transforms`` (skips the agent).

        Used by G.2 to exercise the C.3 backend idempotency contract with
        explicit retry semantics. Returns the raw httpx Response so callers
        can assert on status, headers, and body shape.
        """
        client = self._require_client()
        headers = self._backend_headers(json_body=True)
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return await client.post(
            f"{self._auth_proxy_url}/api/datasets/{dataset_id}/transforms",
            headers=headers,
            content=json.dumps(body),
        )

    async def patch_transforms_direct(
        self,
        dataset_id: str,
        body: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        """Direct PATCH to ``/api/datasets/{id}/transforms`` (the soft-delete /
        update entry point that stands in for ``DELETE /rows/{id}`` per the
        bead's mutation set).
        """
        client = self._require_client()
        headers = self._backend_headers(json_body=True)
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        return await client.patch(
            f"{self._auth_proxy_url}/api/datasets/{dataset_id}/transforms",
            headers=headers,
            content=json.dumps(body),
        )

    async def list_dataset_transforms(self, dataset_id: str) -> list[dict[str, Any]]:
        """Return the dataset's persisted transforms via GET /api/datasets/{id}.

        Used by G.2 to verify that an idempotent retry did not actually
        create a duplicate row in the metadata store.
        """
        client = self._require_client()
        res = await client.get(
            f"{self._auth_proxy_url}/api/datasets/{dataset_id}",
            headers=self._backend_headers(),
            params={"include_transforms": "true"},
        )
        res.raise_for_status()
        data = unwrap_jsonapi(res.json())
        # Phase 1 (dc-wcy.5): the typed ``to_transform_records`` mapper is
        # introduced + tested; the facade keeps the test-facing ``list[dict]``
        # surface verbatim. Phase 2 will wire ``TransformRecord`` through.
        return list(data.get("transforms") or [])

    # ----- internals --------------------------------------------------------

    def _require_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError(
                "DatasetLayerHarness must be used as an async context manager (`async with`)",
            )
        return self._client

    def _backend_headers(self, *, json_body: bool = False) -> dict[str, str]:
        return bearer(self._pat or self._user_jwt, json_body=json_body)

    def _agent_headers(self) -> dict[str, str]:
        # Worker's authMiddleware verifies against backend JWKS only — must use the dev JWT,
        # never the auth-proxy-minted PAT.
        return bearer(self._user_jwt, json_body=True)

    async def _drive_one_turn(
        self,
        prompt: str,
        *,
        dataset_id: str | None,
        table_schema: dict[str, Any] | None,
        thread_id: str | None = None,
    ) -> ChatEventTrace:
        client = self._require_client()
        body: dict[str, Any] = {
            "messages": [{"role": "user", "content": prompt}],
            "contextType": "dataset" if dataset_id else None,
        }
        if dataset_id:
            body["contextId"] = dataset_id
        if table_schema is not None:
            body["tableSchema"] = table_schema
        if self._project_id:
            body["project_id"] = self._project_id
        if thread_id:
            body["thread_id"] = thread_id
        res = await client.post(
            f"{self._agent_url}/chat",
            headers=self._agent_headers(),
            content=json.dumps(body),
        )
        if res.status_code != 200:
            raise AssertionError(
                f"worker /chat returned {res.status_code}: {res.text[:500]}",
            )
        events, raw_tool_call_seen = parse_chat_event_frames(res.content)
        return ChatEventTrace(events=events, raw_tool_call_seen=raw_tool_call_seen)


# ---------------------------------------------------------------------------
# Token helpers — module-level re-exports of AuthApi @staticmethod methods
# ---------------------------------------------------------------------------
#
# Conftest fixtures import these names directly (e.g.
# ``from .harness import fetch_dev_user_jwt``); preserving them as module-level
# attributes keeps that import surface stable across the wrapper extraction.

fetch_dev_user_jwt = AuthApi.fetch_dev_user_jwt
mint_pat = AuthApi.mint_pat
revoke_pat = AuthApi.revoke_pat


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_rephrase(original: str, attempt: int) -> str:
    """Lookup-table rephrases per design §5 (Q1).

    Falls back to a generic "in other words" prefix when the original prompt
    is not in the table. Attempt is 1-indexed.
    """
    if attempt == 1:
        suffix_map: dict[str, str] = {
            "Trim whitespace on every text column": ("Remove leading and trailing spaces from all text columns"),
            "Standardize the region column to title case": (
                "Convert every region value to title case so the column has 4 distinct values"
            ),
        }
        if original in suffix_map:
            return suffix_map[original]
    return f"In other words: {original}"


# ---------------------------------------------------------------------------
# Env helpers — used by conftest skip semantics
# ---------------------------------------------------------------------------


def required_env_or_skip_reason(names: Iterable[str]) -> str | None:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        return f"required env not set: {', '.join(missing)}"
    return None
