"""AC4.3 smoke probe — chat-driven trim_whitespace via worker dispatch.

This is the value-validation smoke probe for ``api-driven-user-flow-tests``
(bead ``dc-ms8.4``). It mirrors the §10 worked-example shape from
``docs/evolution/2026-05-01-api-driven-user-flow-tests.md`` for a single
representative cleaning-tool path: send prompt → observe ``ChatEvent``s on
the worker SSE stream → query backend dataset state.

Companion to ``agent/test/chat/acceptance/walking-skeleton.test.ts``: the
walking skeleton guards the protocol contract from the worker side
(transform_applied event shape, no raw Groq tool-call deltas leaking). This
probe extends the assertion across the worker→backend boundary by also
querying ``GET /api/datasets/{id}?include_preview=true`` and confirming the
trim has actually landed in the persisted column.

Skip semantics mirror ``backend/tests/integration/test_lake_preview_live.py``
and the walking skeleton: the test is a permanent guard but only executes
when the operator has provisioned the live SUT. Required env:

    AGENT_URL          base URL of the worker (e.g. http://localhost:8787)
    BACKEND_URL        base URL of the backend (e.g. http://localhost:8000)
    SMOKE_DATASET_ID   dataset to target (operator-provisioned)
    SMOKE_COLUMN       text column to trim (must contain leading/trailing whitespace)
    SMOKE_JWT          dev JWT (defaults to ``dev-token-static``)
    SMOKE_PROJECT_ID   optional; some routes may require it

Run locally::

    docker compose up -d backend worker query-engine minio
    # (operator: upload a CSV with whitespace in one column, capture the IDs)
    AGENT_URL=http://localhost:8787 BACKEND_URL=http://localhost:8000 \\
    SMOKE_DATASET_ID=<id> SMOKE_COLUMN=region \\
    uv run pytest backend/tests/integration/dataset_layer/ -v

In CI the test runs only on jobs that publish all four required env vars.
"""

from __future__ import annotations

import json
import os
import socket
from urllib.parse import urlparse

import httpx
import pytest

# ---------------------------------------------------------------------------
# Skip-when-unavailable plumbing (mirrors test_lake_preview_live.py)
# ---------------------------------------------------------------------------


def _service_reachable(url: str, timeout: float = 0.5) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


AGENT_URL = os.environ.get("AGENT_URL", "").rstrip("/")
BACKEND_URL = os.environ.get("BACKEND_URL", "").rstrip("/")
SMOKE_DATASET_ID = os.environ.get("SMOKE_DATASET_ID", "")
SMOKE_COLUMN = os.environ.get("SMOKE_COLUMN", "")
SMOKE_JWT = os.environ.get("SMOKE_JWT", "dev-token-static")
SMOKE_PROJECT_ID = os.environ.get("SMOKE_PROJECT_ID", "")


def _required_env_missing() -> str | None:
    if not AGENT_URL:
        return "AGENT_URL not set"
    if not BACKEND_URL:
        return "BACKEND_URL not set"
    if not SMOKE_DATASET_ID:
        return "SMOKE_DATASET_ID not set"
    if not SMOKE_COLUMN:
        return "SMOKE_COLUMN not set"
    if not _service_reachable(AGENT_URL):
        return f"worker not reachable at {AGENT_URL}"
    if not _service_reachable(BACKEND_URL):
        return f"backend not reachable at {BACKEND_URL}"
    return None


pytestmark = pytest.mark.skipif(
    _required_env_missing() is not None,
    reason=(
        f"smoke probe inputs/services not available: {_required_env_missing()}; see docstring for the required env"
    ),
)


# ---------------------------------------------------------------------------
# SSE frame parsing (AI SDK data-stream format used by worker handleChat)
# ---------------------------------------------------------------------------


def _parse_chat_event_frames(body: bytes) -> tuple[list[dict], bool]:
    """Parse the AI SDK data-stream body into (events, raw_tool_call_seen).

    Frames are ``<prefix>:<json>\\n`` lines. ChatEvent annotations arrive on
    prefix ``8`` (see ``agent/lib/chat/handleChat.ts :: injectEmittedEvents``).
    Prefix ``9`` (raw Groq tool-call deltas) MUST NOT appear — that would mean
    the worker dispatcher is leaking, violating AC1.4.
    """
    events: list[dict] = []
    raw_tool_call_seen = False
    text = body.decode("utf-8", errors="replace")
    for line in text.split("\n"):
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
# The smoke probe
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trim_whitespace_via_chat_propagates_to_dataset_state() -> None:
    """AC4.3 smoke: ``Trim whitespace on the <col> column`` lands end-to-end.

    Asserts the §10 shape:
      1. POST ``/chat`` returns 200 with a parseable AI SDK SSE stream.
      2. The stream emits at least one ``transform_applied`` ``ChatEvent``
         with ``operation == "trim"`` and the targeted column.
      3. No raw Groq tool-call deltas leak (AC1.4 — worker is the single
         dispatcher).
      4. ``GET /api/datasets/{id}?include_preview=true`` shows that column
         has no leading/trailing whitespace in the preview rows.
    """
    headers = {
        "Authorization": f"Bearer {SMOKE_JWT}",
        "Content-Type": "application/json",
    }
    chat_body: dict = {
        "messages": [
            {"role": "user", "content": f"Trim whitespace on the {SMOKE_COLUMN} column"},
        ],
        "contextType": "dataset",
        "contextId": SMOKE_DATASET_ID,
        "tableSchema": {"columns": [{"id": SMOKE_COLUMN, "type": "string"}]},
    }
    if SMOKE_PROJECT_ID:
        chat_body["project_id"] = SMOKE_PROJECT_ID

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
        # (1) Drive the worker.
        chat_res = await client.post(f"{AGENT_URL}/chat", headers=headers, content=json.dumps(chat_body))
        assert chat_res.status_code == 200, f"worker /chat returned {chat_res.status_code}: {chat_res.text[:500]}"
        events, raw_tool_call_seen = _parse_chat_event_frames(chat_res.content)

        # (3) AC1.4 invariant.
        assert not raw_tool_call_seen, (
            "raw Groq tool-call delta (frame prefix '9:') leaked through SSE; worker is no longer the single dispatcher"
        )

        # (2) §10 typed event shape.
        applied = [
            e
            for e in events
            if e.get("type") == "transform_applied"
            and e.get("operation") == "trim"
            and e.get("column") == SMOKE_COLUMN
            and e.get("dataset_id") == SMOKE_DATASET_ID
        ]
        assert applied, (
            f"no transform_applied event for column={SMOKE_COLUMN} "
            f"operation=trim dataset_id={SMOKE_DATASET_ID}; "
            f"saw events: {[e.get('type') for e in events]!r}"
        )

        # (4) Backend state assertion — the trim actually landed in the column.
        ds_res = await client.get(
            f"{BACKEND_URL}/api/datasets/{SMOKE_DATASET_ID}",
            params={"include_preview": "true", "preview_limit": "100"},
            headers={"Authorization": f"Bearer {SMOKE_JWT}"},
        )
        assert ds_res.status_code == 200, f"backend GET dataset returned {ds_res.status_code}: {ds_res.text[:500]}"
        body = ds_res.json()
        preview = body.get("preview") or body.get("preview_rows") or []
        assert preview, f"dataset preview empty; cannot verify trim landed; body keys={list(body)!r}"

        offenders = [
            row.get(SMOKE_COLUMN)
            for row in preview
            if isinstance(row.get(SMOKE_COLUMN), str) and row[SMOKE_COLUMN] != row[SMOKE_COLUMN].strip()
        ]
        assert not offenders, (
            f"column {SMOKE_COLUMN} still has leading/trailing whitespace after chat-driven trim: {offenders[:5]!r}"
        )
