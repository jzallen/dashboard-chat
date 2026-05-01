"""DatasetLayerHarness — drives the dataset (staging) layer over the API.

Implements the harness shape defined in
``docs/feature/api-driven-user-flow-tests/design/design.md`` §7. The harness
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
from typing import Any

import httpx

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# SSE frame parser (AI SDK data-stream format — same shape as smoke probe)
# ---------------------------------------------------------------------------


def parse_chat_event_frames(body: bytes) -> tuple[list[dict[str, Any]], bool]:
    """Parse the AI SDK data-stream body into (events, raw_tool_call_seen).

    The worker emits each ``ChatEvent`` on prefix ``8`` (annotations); raw
    Groq tool-call deltas appear on prefix ``9``. Per AC1.4, prefix ``9``
    MUST NOT leak — that would mean the worker dispatcher is no longer the
    single dispatcher.
    """
    events: list[dict[str, Any]] = []
    raw_tool_call_seen = False
    for line in body.decode("utf-8", errors="replace").split("\n"):
        if not line:
            continue
        prefix, sep, payload = line.partition(":")
        if not sep or not payload:
            continue
        payload = payload.strip()
        if prefix == "9":
            raw_tool_call_seen = True
            continue
        if prefix not in ("2", "8"):
            continue
        try:
            parts = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if not isinstance(parts, list):
            continue
        for part in parts:
            if isinstance(part, dict) and "type" in part:
                events.append(part)
    return events, raw_tool_call_seen


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
        async def count_by(dataset_id, column): -> dict[str, int]

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

    # ----- lifecycle --------------------------------------------------------

    async def __aenter__(self) -> DatasetLayerHarness:
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(self._timeout))
        if self._owns_project:
            self._project_id = await self.create_project(f"dataset-staging-{_new_ulid_suffix()}")
        return self

    async def __aexit__(self, *_: object) -> None:
        try:
            if self._owns_project and self._project_id and self._client is not None:
                await self._client.delete(
                    f"{self._auth_proxy_url}/api/projects/{self._project_id}",
                    headers=self._backend_headers(),
                )
        finally:
            if self._client is not None:
                await self._client.aclose()
                self._client = None

    # ----- public API -------------------------------------------------------

    async def create_project(self, name: str) -> str:
        """Create a project via auth-proxy → backend; return its id."""
        client = self._require_client()
        res = await client.post(
            f"{self._auth_proxy_url}/api/projects",
            headers=self._backend_headers(json_body=True),
            content=json.dumps({"name": name}),
        )
        res.raise_for_status()
        body = res.json()
        return _project_id_from_response(body)

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
        body = res.json()
        return _dataset_id_from_response(body)

    async def chat_turn(
        self,
        prompt: str,
        *,
        dataset_id: str | None = None,
        table_schema: dict[str, Any] | None = None,
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
            trace = await self._drive_one_turn(current, dataset_id=dataset_id, table_schema=table_schema)
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
        body = res.json()
        # Backend response shape: {data: {...}} or {...}; tolerate both.
        data = body.get("data", body)
        preview = data.get("preview") or data.get("preview_rows") or []
        columns = data.get("columns") or data.get("schema", {}).get("columns") or []
        row_count = data.get("row_count") or data.get("rows") or len(preview)
        return TableState(
            dataset_id=dataset_id,
            row_count=int(row_count) if row_count is not None else 0,
            columns=columns,
            preview=preview,
        )

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

    async def count_by(self, dataset_id: str, column: str) -> dict[str, int]:
        """Fetch the full preview window and reduce client-side by ``column``.

        For the demo workload (250-row table) the preview window is the full
        table; if a future workload exceeds the preview window the harness
        should switch to a server-side aggregate endpoint. Surfaced as a
        deliberately simple shape per design §7.
        """
        state = await self.get_table_state(dataset_id, preview_limit=100)
        counts: dict[str, int] = {}
        for row in state.preview:
            val = row.get(column)
            if val is None:
                continue
            counts[str(val)] = counts.get(str(val), 0) + 1
        return counts

    # ----- internals --------------------------------------------------------

    def _require_client(self) -> httpx.AsyncClient:
        if self._client is None:
            raise RuntimeError(
                "DatasetLayerHarness must be used as an async context manager (`async with`)",
            )
        return self._client

    def _backend_headers(self, *, json_body: bool = False) -> dict[str, str]:
        token = self._pat or self._user_jwt
        headers = {"Authorization": f"Bearer {token}"}
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _agent_headers(self) -> dict[str, str]:
        # Worker's authMiddleware verifies against backend JWKS only — must use the dev JWT,
        # never the auth-proxy-minted PAT.
        return {
            "Authorization": f"Bearer {self._user_jwt}",
            "Content-Type": "application/json",
        }

    async def _drive_one_turn(
        self,
        prompt: str,
        *,
        dataset_id: str | None,
        table_schema: dict[str, Any] | None,
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
# Token helpers — exposed at module scope so conftest fixtures can reuse them
# ---------------------------------------------------------------------------


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
            headers={
                "Authorization": f"Bearer {user_jwt}",
                "Content-Type": "application/json",
            },
            content=json.dumps({"name": name, "expires_in_seconds": expires_in_seconds}),
        )
        res.raise_for_status()
        body = res.json()
    pat_id = body.get("id")
    token = body.get("token")
    if not isinstance(pat_id, str) or not isinstance(token, str):
        raise RuntimeError(f"PAT issuance returned unexpected shape: {body!r}")
    return pat_id, token


async def revoke_pat(auth_proxy_url: str, user_jwt: str, pat_id: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 404 is acceptable: e.g., already revoked / unknown id.
        await client.delete(
            f"{auth_proxy_url.rstrip('/')}/api/auth/pats/{pat_id}",
            headers={"Authorization": f"Bearer {user_jwt}"},
        )


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


def _project_id_from_response(body: dict[str, Any]) -> str:
    """Tolerate `{id, ...}` and `{data: {id, ...}}` response shapes."""
    if isinstance(body.get("data"), dict):
        body = body["data"]
    pid = body.get("id")
    if not isinstance(pid, str):
        raise RuntimeError(f"create_project: no id in response body: {body!r}")
    return pid


def _dataset_id_from_response(body: dict[str, Any]) -> str:
    if isinstance(body.get("data"), dict):
        body = body["data"]
    did = body.get("id") or body.get("dataset_id")
    if not isinstance(did, str):
        raise RuntimeError(f"upload_csv: no dataset id in response body: {body!r}")
    return did


# ---------------------------------------------------------------------------
# Env helpers — used by conftest skip semantics
# ---------------------------------------------------------------------------


def required_env_or_skip_reason(names: Iterable[str]) -> str | None:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        return f"required env not set: {', '.join(missing)}"
    return None
