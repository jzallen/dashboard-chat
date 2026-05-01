"""Tests for RedisSessionEventReader (Epic F.2 — ADR-017).

Pins the cursor contract documented at event_replay.py:64-69 and ADR-017:
  - `since=None` → from the beginning.
  - `since=<cursor>` → events strictly after `<cursor>`.
  - `next_cursor=None` ⟺ no more events as of the read.
  - `has_more=True` only when more entries exist than fit in the page.

Uses fakeredis so the suite has no docker dependency. The compose-runnable
smoke test (`tests/integration/test_session_event_replay_redis.py`) covers
the same contract against a real Redis to catch any fakeredis vs. server
behavioral drift.
"""

from __future__ import annotations

import json
from typing import Any

import fakeredis.aioredis
import pytest

from app.use_cases.session.event_replay import EventsPage
from app.use_cases.session.redis_session_event_reader import (
    EVENT_FIELD,
    RedisSessionEventReader,
    stream_key,
)


@pytest.fixture
async def redis_client():
    """A fresh in-memory Redis per test (decode_responses=True for str cursors)."""
    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield client
    await client.aclose()


@pytest.fixture
def reader(redis_client) -> RedisSessionEventReader:
    return RedisSessionEventReader(redis_client)


async def _xadd_event(redis_client, thread_id: str, event: dict[str, Any]) -> str:
    """Append one event; return the entry id (cursor)."""
    return await redis_client.xadd(stream_key(thread_id), {EVENT_FIELD: json.dumps(event)})


class TestEmptyStream:
    async def test_returns_empty_page_when_no_events(self, reader):
        page = await reader.get_events(stream_thread_id="thread_xyz", since=None, limit=10)
        assert page == EventsPage(events=[], next_cursor=None, has_more=False)

    async def test_returns_empty_page_for_unknown_thread(self, reader, redis_client):
        await _xadd_event(redis_client, "other_thread", {"type": "row_added", "row_id": "r1"})
        page = await reader.get_events(stream_thread_id="missing", since=None, limit=10)
        assert page.events == []
        assert page.next_cursor is None
        assert page.has_more is False


class TestSingleSession:
    async def test_returns_all_events_in_insertion_order(self, reader, redis_client):
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r1"})
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r2"})
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r3"})

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=100)
        assert [e["row_id"] for e in page.events] == ["r1", "r2", "r3"]
        assert page.has_more is False
        assert page.next_cursor is None  # tail consumed

    async def test_strictly_after_cursor_excludes_boundary(self, reader, redis_client):
        """ADR-017: `since=<cursor>` returns events strictly after `<cursor>`.

        This is the boundary the bead description called out as previously
        unpinned — `event_replay.py:64-69` says 'strictly after' but Phase 1
        had no test holding the line.
        """
        c1 = await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r1"})
        c2 = await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r2"})
        c3 = await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r3"})

        page = await reader.get_events(stream_thread_id="t1", since=c1, limit=100)
        assert [e["row_id"] for e in page.events] == ["r2", "r3"]
        # The boundary cursor (c1) must NOT appear in the result.
        assert all(c != c1 for c in (c2, c3))  # sanity

        page2 = await reader.get_events(stream_thread_id="t1", since=c2, limit=100)
        assert [e["row_id"] for e in page2.events] == ["r3"]

        page3 = await reader.get_events(stream_thread_id="t1", since=c3, limit=100)
        assert page3.events == []
        assert page3.next_cursor is None
        assert page3.has_more is False


class TestPagination:
    async def test_has_more_true_when_more_entries_than_limit(self, reader, redis_client):
        for i in range(5):
            await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": f"r{i}"})

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=2)
        assert len(page.events) == 2
        assert [e["row_id"] for e in page.events] == ["r0", "r1"]
        assert page.has_more is True
        assert page.next_cursor is not None

    async def test_next_cursor_drives_subsequent_page(self, reader, redis_client):
        for i in range(5):
            await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": f"r{i}"})

        page1 = await reader.get_events(stream_thread_id="t1", since=None, limit=2)
        page2 = await reader.get_events(stream_thread_id="t1", since=page1.next_cursor, limit=2)
        page3 = await reader.get_events(stream_thread_id="t1", since=page2.next_cursor, limit=2)

        assert [e["row_id"] for e in page1.events] == ["r0", "r1"]
        assert [e["row_id"] for e in page2.events] == ["r2", "r3"]
        assert [e["row_id"] for e in page3.events] == ["r4"]
        assert page3.has_more is False
        assert page3.next_cursor is None

    async def test_next_cursor_none_when_tail_consumed_in_one_page(self, reader, redis_client):
        for i in range(3):
            await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": f"r{i}"})

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert len(page.events) == 3
        assert page.has_more is False
        assert page.next_cursor is None


class TestSessionIsolation:
    async def test_threads_are_isolated(self, reader, redis_client):
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r1-t1"})
        await _xadd_event(redis_client, "t2", {"type": "row_added", "row_id": "r1-t2"})

        page_t1 = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        page_t2 = await reader.get_events(stream_thread_id="t2", since=None, limit=10)

        assert [e["row_id"] for e in page_t1.events] == ["r1-t1"]
        assert [e["row_id"] for e in page_t2.events] == ["r1-t2"]


class TestMalformedEntries:
    async def test_skips_entries_without_data_field(self, reader, redis_client):
        await redis_client.xadd(stream_key("t1"), {"unrelated": "x"})
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r1"})

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert [e["row_id"] for e in page.events] == ["r1"]

    async def test_skips_entries_with_invalid_json(self, reader, redis_client):
        await redis_client.xadd(stream_key("t1"), {EVENT_FIELD: "{not-json"})
        await _xadd_event(redis_client, "t1", {"type": "row_added", "row_id": "r1"})

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert [e["row_id"] for e in page.events] == ["r1"]


class TestKeyDerivation:
    def test_stream_key_uses_session_namespace(self):
        """Mirrors the TS-side `redisThreadPersister.ts:streamKey` — keep in sync."""
        assert stream_key("abc-123") == "session:events:abc-123"
