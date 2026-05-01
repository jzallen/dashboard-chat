"""Tests for StreamIoSessionEventReader (Epic F.2 — ADR-017).

Stream.io's API is mocked at the SDK boundary (the `StreamChatAsync.channel`
return value). The cursor contract is identical to the Redis reader; the
mock simulates Stream.io's `id_gt` pagination semantics.

A real-Stream.io integration test (gated on `STREAM_IO_API_KEY`) lives in
`tests/integration/test_stream_io_session_event_reader_live.py` so the
mock can't drift from server behavior unnoticed.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.use_cases.session.event_replay import EventsPage
from app.use_cases.session.stream_io_session_event_reader import (
    EVENT_PAYLOAD_FIELD,
    StreamIoSessionEventReader,
)


def _make_message(message_id: str, event_type: str, **fields: Any) -> dict[str, Any]:
    """Compose a Stream.io message-shaped dict carrying a DomainEvent payload."""
    return {
        "id": message_id,
        EVENT_PAYLOAD_FIELD: {"type": event_type, **fields},
    }


@pytest.fixture
def channel_query():
    """Mock Stream.io channel.query — returns whatever `messages` we set."""
    query = AsyncMock()
    query.return_value = {"messages": []}
    return query


@pytest.fixture
def stream_client(channel_query):
    """Mock StreamChatAsync whose `channel(...)` returns a query-only stub."""
    channel = MagicMock()
    channel.query = channel_query
    client = MagicMock()
    client.channel = MagicMock(return_value=channel)
    return client


@pytest.fixture
def reader(stream_client) -> StreamIoSessionEventReader:
    return StreamIoSessionEventReader(stream_client)


class TestEmptyChannel:
    async def test_returns_empty_page_when_no_messages(self, reader):
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert page == EventsPage(events=[], next_cursor=None, has_more=False)


class TestStrictlyAfterCursor:
    async def test_passes_id_gt_to_channel_query(self, reader, channel_query, stream_client):
        await reader.get_events(stream_thread_id="t1", since="msg-42", limit=5)

        # The reader should hand id_gt directly to Stream.io for cursor enforcement.
        kwargs = channel_query.await_args.kwargs
        assert kwargs["messages"]["id_gt"] == "msg-42"
        assert kwargs["messages"]["limit"] == 6  # limit+1 to detect has_more

    async def test_omits_id_gt_when_since_is_none(self, reader, channel_query):
        await reader.get_events(stream_thread_id="t1", since=None, limit=5)
        kwargs = channel_query.await_args.kwargs
        assert "id_gt" not in kwargs["messages"]


class TestPagination:
    async def test_has_more_when_more_than_limit(self, reader, channel_query):
        channel_query.return_value = {
            "messages": [_make_message(f"m{i}", "row_added", row_id=f"r{i}") for i in range(6)]
        }

        page = await reader.get_events(stream_thread_id="t1", since=None, limit=5)
        assert len(page.events) == 5
        assert [e["row_id"] for e in page.events] == [f"r{i}" for i in range(5)]
        assert page.has_more is True
        assert page.next_cursor == "m4"

    async def test_no_has_more_when_tail_consumed(self, reader, channel_query):
        channel_query.return_value = {
            "messages": [_make_message(f"m{i}", "row_added", row_id=f"r{i}") for i in range(3)]
        }
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert len(page.events) == 3
        assert page.has_more is False
        assert page.next_cursor is None


class TestNonReplayMessages:
    async def test_skips_messages_without_event_payload(self, reader, channel_query):
        """Stream.io threads carry user-typed messages too; only replay
        messages have the `event_payload` custom field."""
        channel_query.return_value = {
            "messages": [
                {"id": "m1", "text": "hello world"},  # plain user message
                _make_message("m2", "row_added", row_id="r1"),
                {"id": "m3", "text": "another"},
                _make_message("m4", "row_deleted", row_id="r1"),
            ]
        }
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert [e["type"] for e in page.events] == ["row_added", "row_deleted"]


class TestPayloadCoercion:
    async def test_accepts_dict_payload(self, reader, channel_query):
        channel_query.return_value = {
            "messages": [{"id": "m1", EVENT_PAYLOAD_FIELD: {"type": "row_added", "row_id": "r1"}}]
        }
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert page.events == [{"type": "row_added", "row_id": "r1"}]

    async def test_accepts_json_string_payload(self, reader, channel_query):
        channel_query.return_value = {
            "messages": [{"id": "m1", EVENT_PAYLOAD_FIELD: '{"type":"row_added","row_id":"r1"}'}]
        }
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert page.events == [{"type": "row_added", "row_id": "r1"}]

    async def test_skips_unparseable_payload(self, reader, channel_query):
        channel_query.return_value = {
            "messages": [
                {"id": "m1", EVENT_PAYLOAD_FIELD: "{not-json"},
                {"id": "m2", EVENT_PAYLOAD_FIELD: {"type": "row_added", "row_id": "r1"}},
            ]
        }
        page = await reader.get_events(stream_thread_id="t1", since=None, limit=10)
        assert page.events == [{"type": "row_added", "row_id": "r1"}]


class TestChannelType:
    async def test_uses_default_channel_type(self, reader, stream_client):
        await reader.get_events(stream_thread_id="t1", since=None, limit=1)
        stream_client.channel.assert_called_once_with("messaging", "t1")

    async def test_overridden_channel_type_propagates(self, stream_client):
        custom = StreamIoSessionEventReader(stream_client, channel_type="threads")
        await custom.get_events(stream_thread_id="t1", since=None, limit=1)
        stream_client.channel.assert_called_once_with("threads", "t1")
