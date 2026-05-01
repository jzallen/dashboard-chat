"""Compose-runnable smoke test for the Redis SessionEventReader path
(Epic F.2 — `dc-qj9.1.2`).

Pins the F.2 acceptance gate:

    "An event persisted via the worker is retrievable by the backend's
    replay endpoint within the same logical session, without Stream.io
    credentials."

This test simulates the worker by writing through the real
`RedisThreadPersister` contract — a JSON-encoded event in the `data` field of
the `session:events:<thread_id>` Redis Stream — then reads it back through
`RedisSessionEventReader` (the same code path the FastAPI replay endpoint
uses in production).

Skipped when Redis is not reachable (e.g. CI without docker compose). To
run locally::

    docker compose up -d redis
    REDIS_URL=redis://localhost:6379/0 \\
    uv run pytest backend/tests/integration/test_session_event_replay_redis_live.py -v
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
from urllib.parse import urlparse

import pytest
from redis.asyncio import Redis as AsyncRedis

from app.use_cases.session.redis_session_event_reader import (
    EVENT_FIELD,
    RedisSessionEventReader,
    stream_key,
)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def _redis_reachable(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    try:
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
            s.settimeout(0.5)
            s.connect((host, port))
        return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _redis_reachable(REDIS_URL),
    reason=f"Redis not reachable at {REDIS_URL}; run `docker compose up -d redis`",
)


@pytest.fixture
async def redis_client():
    client = AsyncRedis.from_url(REDIS_URL, decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
def thread_id() -> str:
    """A per-test-run thread id so parallel tests don't trip over each other."""
    import uuid

    return f"f2-smoke-{uuid.uuid4().hex[:12]}"


@pytest.fixture
async def cleanup_thread(redis_client, thread_id):
    yield
    await redis_client.delete(stream_key(thread_id))


async def _persist_like_worker(client: AsyncRedis, thread_id: str, events: list[dict]) -> list[str]:
    """Simulate `RedisThreadPersister.persist` (TS) — write each event as a
    `data: <json>` field on the session's stream, returning the assigned ids."""
    ids: list[str] = []
    for event in events:
        entry_id = await client.xadd(stream_key(thread_id), {EVENT_FIELD: json.dumps(event)})
        ids.append(entry_id)
    return ids


class TestRedisAcceptanceGate:
    async def test_event_persisted_by_worker_is_retrievable_by_backend(self, redis_client, thread_id, cleanup_thread):
        """The F.2 acceptance gate, exactly as worded in `dc-qj9.1.2`:
        TS-side persists; Python-side reads; no Stream.io credentials."""
        await _persist_like_worker(
            redis_client,
            thread_id,
            [
                {"type": "row_added", "dataset_id": "d1", "row_id": "r1"},
                {"type": "transform_applied", "transform_id": "t1", "dataset_id": "d1"},
                {"type": "turn_done", "reason": "stop"},
            ],
        )

        reader = RedisSessionEventReader(redis_client)
        page = await reader.get_events(stream_thread_id=thread_id, since=None, limit=100)

        assert [e["type"] for e in page.events] == ["row_added", "transform_applied", "turn_done"]
        assert page.has_more is False
        assert page.next_cursor is None

    async def test_strictly_after_cursor_against_real_redis(self, redis_client, thread_id, cleanup_thread):
        """Pin the boundary the bead description called out as previously
        unpinned. Run against a real Redis so fakeredis behavior is verified
        against the server. (ADR-017 cursor opacity + strictly-after.)"""
        ids = await _persist_like_worker(
            redis_client,
            thread_id,
            [{"type": "row_added", "dataset_id": "d1", "row_id": f"r{i}"} for i in range(3)],
        )

        reader = RedisSessionEventReader(redis_client)

        page = await reader.get_events(stream_thread_id=thread_id, since=ids[0], limit=100)
        assert [e["row_id"] for e in page.events] == ["r1", "r2"]

        page2 = await reader.get_events(stream_thread_id=thread_id, since=ids[1], limit=100)
        assert [e["row_id"] for e in page2.events] == ["r2"]

        page3 = await reader.get_events(stream_thread_id=thread_id, since=ids[2], limit=100)
        assert page3.events == []
        assert page3.next_cursor is None
        assert page3.has_more is False


# Sanity hook: if a developer hand-runs this file as a script, fail fast on
# Redis being absent rather than running 0 tests silently.
if __name__ == "__main__":
    if not _redis_reachable(REDIS_URL):
        raise SystemExit(f"Redis not reachable at {REDIS_URL}")
    asyncio.run(asyncio.sleep(0))
