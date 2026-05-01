"""Redis-backed SessionEventReader (Epic F.2 — ADR-017).

Reads DomainEvents off a Redis Stream keyed by the session's stream_thread_id.
The TS-side `RedisThreadPersister` writes via `XADD`; this reader uses
`XRANGE` to retrieve them.

Cursor format: a Redis stream entry id (e.g., `1735689600000-0`). Opaque to
callers per the ADR-017 contract — they pass it back unchanged.

Strictly-after semantics: Redis `XRANGE key (cursor +` excludes the boundary
entry, so `since=cursor` returns events strictly after `cursor` without an
extra filter pass on our side.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from redis.asyncio import Redis as AsyncRedis

from app.use_cases.session.event_replay import EventsPage

logger = logging.getLogger(__name__)

STREAM_KEY_PREFIX = "session:events:"
EVENT_FIELD = "data"


def stream_key(stream_thread_id: str) -> str:
    """Compose the Redis stream key for a session's event log.

    Kept as a free function so the TS-side persister can mirror the same
    naming convention without re-deriving it (see
    `agent/lib/chat/redisThreadPersister.ts:streamKey`).
    """
    return f"{STREAM_KEY_PREFIX}{stream_thread_id}"


class RedisSessionEventReader:
    """SessionEventReader implementation backed by Redis Streams.

    Each XADD entry stores one DomainEvent JSON in the `data` field. The
    entry id is the cursor — opaque to callers, monotonic by Redis design.
    """

    def __init__(self, client: AsyncRedis):
        self._client = client

    async def get_events(
        self,
        stream_thread_id: str,
        since: str | None,
        limit: int,
    ) -> EventsPage:
        key = stream_key(stream_thread_id)

        # Redis XRANGE syntax: `(start` is exclusive, so `(<cursor>` returns
        # entries strictly after <cursor>. Empty/None `since` starts from `-`
        # (the smallest possible id).
        start = f"({since}" if since else "-"

        # Read one extra entry to determine `has_more` without a second call.
        raw_entries = await self._client.xrange(key, min=start, max="+", count=limit + 1)

        has_more = len(raw_entries) > limit
        page_entries = raw_entries[:limit]

        events: list[dict[str, Any]] = []
        next_cursor: str | None = None
        for entry_id, fields in page_entries:
            payload = fields.get(EVENT_FIELD)
            if payload is None:
                logger.warning(
                    "[RedisSessionEventReader] entry %s in stream %s missing %r field; skipping",
                    entry_id,
                    key,
                    EVENT_FIELD,
                )
                continue
            try:
                events.append(json.loads(payload))
            except json.JSONDecodeError:
                logger.warning(
                    "[RedisSessionEventReader] entry %s in stream %s has non-JSON payload; skipping",
                    entry_id,
                    key,
                )
                continue
            next_cursor = entry_id

        # If `has_more` is False, the caller has consumed the tail — clear
        # `next_cursor` per the Protocol contract ("None means no more events
        # exist as of the read"). Otherwise advertise the last id we returned.
        if not has_more:
            next_cursor = None

        return EventsPage(events=events, next_cursor=next_cursor, has_more=has_more)
