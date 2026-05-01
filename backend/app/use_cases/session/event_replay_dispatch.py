"""Capability-presence dispatch for SessionEventReader (Epic F.2 — ADR-017).

At process startup, `select_session_event_reader` inspects which capability
env vars are configured and returns the matching adapter. Per ADR-017:

  1. `STREAM_API_KEY` AND `STREAM_API_SECRET` set → `StreamIoSessionEventReader`
  2. `REDIS_URL` set                              → `RedisSessionEventReader`
  3. neither                                      → `_NoopSessionEventReader`

The decision is logged once at INFO so an operator can confirm at startup
which adapter is live.

Forbidden: branching on `ENV`, `APP_ENV`, `NODE_ENV`, etc. The presence of
the connection variable is the single source of truth (see ADR-017
"Prohibited: NODE_ENV / ENV-keyed dispatch").
"""

from __future__ import annotations

import logging
from typing import Literal

from redis.asyncio import Redis as AsyncRedis
from stream_chat.async_chat.client import StreamChatAsync

from app.config import Settings
from app.use_cases.session.event_replay import (
    SessionEventReader,
    noop_session_event_reader,
    set_session_event_reader,
)
from app.use_cases.session.redis_session_event_reader import RedisSessionEventReader
from app.use_cases.session.stream_io_session_event_reader import StreamIoSessionEventReader

logger = logging.getLogger(__name__)

ReaderKind = Literal["stream_io", "redis", "noop"]


def _classify(settings: Settings) -> ReaderKind:
    """Decide which reader to use based on capability presence.

    Both Stream.io creds (key + secret) are required to even build the SDK
    client, so we treat their joint presence as the capability gate.
    """
    if settings.stream_api_key and settings.stream_api_secret:
        return "stream_io"
    if settings.redis_url:
        return "redis"
    return "noop"


def _build_stream_io(settings: Settings) -> SessionEventReader:
    client = StreamChatAsync(api_key=settings.stream_api_key, api_secret=settings.stream_api_secret)
    return StreamIoSessionEventReader(client, channel_type=settings.stream_io_channel_type)


def _build_redis(settings: Settings) -> SessionEventReader:
    # `decode_responses=True` returns str (not bytes) for stream entry ids and
    # field payloads — keeps the cursor type aligned with the Protocol's
    # `str | None` and lets us `json.loads` field values directly.
    client = AsyncRedis.from_url(settings.redis_url, decode_responses=True)
    return RedisSessionEventReader(client)


def select_session_event_reader(settings: Settings) -> tuple[SessionEventReader, ReaderKind]:
    """Build the production reader for this process. Pure of side effects
    apart from instantiating the SDK client(s).

    Returns the reader and its kind label so the caller can log it once.
    """
    kind = _classify(settings)
    if kind == "stream_io":
        return _build_stream_io(settings), kind
    if kind == "redis":
        return _build_redis(settings), kind
    return noop_session_event_reader, kind


def install_session_event_reader(settings: Settings) -> ReaderKind:
    """Select + install the reader as the process-wide default.

    Mutates the module-level reference in `app.use_cases.session.event_replay`
    so `get_session_event_reader()` returns the chosen adapter. Idempotent:
    callers may invoke this at startup and from tests without leaking state
    across runs (provided they restore the original reference, e.g. via
    `monkeypatch.setattr`).
    """
    reader, kind = select_session_event_reader(settings)
    set_session_event_reader(reader)
    logger.info("[SessionEventReader] selected adapter: %s", kind)
    return kind
