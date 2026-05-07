"""Capability-presence dispatch for SessionEventReader (Epic F.2 — ADR-017).

At process startup, `select_session_event_reader` inspects which capability
env vars are configured and returns the matching adapter:

  1. `REDIS_URL` set → `RedisSessionEventReader`
  2. unset           → `_NoopSessionEventReader`

The decision is logged once at INFO so an operator can confirm at startup
which adapter is live.

Forbidden: branching on `ENV`, `APP_ENV`, `NODE_ENV`, etc. The presence of
the connection variable is the single source of truth (see ADR-017
"Prohibited: NODE_ENV / ENV-keyed dispatch").

Note: a Stream.io tier was removed in Phase 1 of the Stream.io → Redis
migration — the surviving Protocol contract is unchanged for callers.
"""

from __future__ import annotations

import logging
from typing import Literal

from redis.asyncio import Redis as AsyncRedis

from app.config import Settings
from app.use_cases.session.event_replay import (
    SessionEventReader,
    noop_session_event_reader,
    set_session_event_reader,
)
from app.use_cases.session.redis_session_event_reader import RedisSessionEventReader

logger = logging.getLogger(__name__)

ReaderKind = Literal["redis", "noop"]


def _classify(settings: Settings) -> ReaderKind:
    """Decide which reader to use based on capability presence."""
    if settings.redis_url:
        return "redis"
    return "noop"


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
