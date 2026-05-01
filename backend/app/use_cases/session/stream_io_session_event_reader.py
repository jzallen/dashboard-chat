"""Stream.io-backed SessionEventReader (Epic F.2 — ADR-017).

Reads DomainEvents off a Stream.io thread (channel) via the `stream-chat`
Python SDK. Each event is stored as a custom field on a Stream.io message;
the cursor is the Stream.io message id.

Contract with the agent-side writer (deferred to a separate leaf):
  - Channel id == `stream_thread_id`.
  - Channel type == `STREAM_IO_CHANNEL_TYPE` (default `"messaging"`); override
    with the `STREAM_IO_CHANNEL_TYPE` env var if your Stream.io app uses a
    different channel type for chat threads.
  - Each persisted DomainEvent goes on its own Stream.io message with the
    JSON payload in the `event_payload` custom field. The message text is
    irrelevant to replay (Stream.io's own UI surfaces the assistant's text
    via the upstream message; replay events are out-of-band data).
  - `id_gt` pagination: Stream.io's `messages.id_gt` is exclusive, so
    `since=<message_id>` returns events strictly after `<message_id>` —
    matching the ADR-017 cursor contract.

Selected by `event_replay_dispatch.select_session_event_reader` when
`STREAM_IO_API_KEY` is set in the environment. The matching Python-side
agent-writer is intentionally out of scope for F.2; until it lands, this
reader is observably correct against any other system writing to the same
channel (e.g., a future TS-side persister, or test fixtures).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from stream_chat.async_chat.client import StreamChatAsync

from app.use_cases.session.event_replay import EventsPage

logger = logging.getLogger(__name__)

DEFAULT_CHANNEL_TYPE = "messaging"
EVENT_PAYLOAD_FIELD = "event_payload"


class StreamIoSessionEventReader:
    """SessionEventReader backed by Stream.io threads.

    Cursor = Stream.io message id. Strictly-after is enforced via Stream.io's
    `messages.id_gt` pagination option.
    """

    def __init__(self, client: StreamChatAsync, channel_type: str = DEFAULT_CHANNEL_TYPE):
        self._client = client
        self._channel_type = channel_type

    async def get_events(
        self,
        stream_thread_id: str,
        since: str | None,
        limit: int,
    ) -> EventsPage:
        channel = self._client.channel(self._channel_type, stream_thread_id)

        # Read one extra to determine `has_more` without a second call.
        message_options: dict[str, Any] = {"limit": limit + 1}
        if since:
            message_options["id_gt"] = since

        response = await channel.query(messages=message_options, watch=False, state=False)
        raw_messages = response.get("messages", [])

        has_more = len(raw_messages) > limit
        page_messages = raw_messages[:limit]

        events: list[dict[str, Any]] = []
        next_cursor: str | None = None
        for message in page_messages:
            payload = message.get(EVENT_PAYLOAD_FIELD)
            if payload is None:
                # Not a replay event — Stream.io threads can carry user
                # messages too. Skip silently; this is the design.
                continue
            event = _coerce_payload(payload)
            if event is None:
                logger.warning(
                    "[StreamIoSessionEventReader] message %s in channel %s has unparseable %r; skipping",
                    message.get("id"),
                    stream_thread_id,
                    EVENT_PAYLOAD_FIELD,
                )
                continue
            events.append(event)
            next_cursor = message.get("id")

        if not has_more:
            next_cursor = None

        return EventsPage(events=events, next_cursor=next_cursor, has_more=has_more)


def _coerce_payload(payload: Any) -> dict[str, Any] | None:
    """Stream.io custom fields can round-trip as either a dict or a JSON string
    depending on how the writer set them. Accept both."""
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            decoded = json.loads(payload)
        except json.JSONDecodeError:
            return None
        return decoded if isinstance(decoded, dict) else None
    return None
