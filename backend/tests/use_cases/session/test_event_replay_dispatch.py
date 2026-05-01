"""Tests for the SessionEventReader dispatch helper (Epic F.2 — ADR-017).

Pins the capability-presence routing rule:
  STREAM_API_KEY+SECRET → stream_io
  REDIS_URL             → redis
  neither               → noop

ENV-name-based dispatch (NODE_ENV / APP_ENV / etc.) is forbidden by ADR-017;
these tests would be the first place a regression toward env-keying would
break. We don't add a negative test for "ENV setting changes the result"
because the helper has no `ENV` knob and never reads one — encoding "we
don't read it" as a green test would invert the assertion direction.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.use_cases.session import event_replay
from app.use_cases.session.event_replay import _NoopSessionEventReader, get_session_event_reader
from app.use_cases.session.event_replay_dispatch import (
    install_session_event_reader,
    select_session_event_reader,
)
from app.use_cases.session.redis_session_event_reader import RedisSessionEventReader
from app.use_cases.session.stream_io_session_event_reader import StreamIoSessionEventReader


@pytest.fixture(autouse=True)
def _restore_active_reader():
    """install_session_event_reader mutates module state; restore afterwards
    so tests don't leak."""
    original = event_replay._active_reader
    yield
    event_replay._active_reader = original


def _settings(**overrides) -> Settings:
    base = {"stream_api_key": "", "stream_api_secret": "", "redis_url": ""}
    base.update(overrides)
    return Settings(**base)


class TestSelection:
    """`select_session_event_reader` is sync, but Stream.io's SDK constructs
    an aiohttp connector that needs a running event loop. Tests that exercise
    the Stream.io branch are async; the others stay sync to make the absence
    of an async dependency visible."""

    async def test_picks_stream_io_when_both_creds_set(self):
        reader, kind = select_session_event_reader(_settings(stream_api_key="k", stream_api_secret="s"))
        assert kind == "stream_io"
        assert isinstance(reader, StreamIoSessionEventReader)

    def test_falls_back_to_redis_when_only_stream_key_present(self):
        """Both Stream.io creds are required to build the SDK client; key
        alone is not enough to trigger Stream.io selection."""
        reader, kind = select_session_event_reader(_settings(stream_api_key="k", redis_url="redis://localhost:6379/0"))
        assert kind == "redis"
        assert isinstance(reader, RedisSessionEventReader)

    def test_falls_back_to_redis_when_only_stream_secret_present(self):
        reader, kind = select_session_event_reader(
            _settings(stream_api_secret="s", redis_url="redis://localhost:6379/0")
        )
        assert kind == "redis"
        assert isinstance(reader, RedisSessionEventReader)

    def test_picks_redis_when_only_redis_url_set(self):
        reader, kind = select_session_event_reader(_settings(redis_url="redis://localhost:6379/0"))
        assert kind == "redis"
        assert isinstance(reader, RedisSessionEventReader)

    def test_picks_noop_when_nothing_configured(self):
        reader, kind = select_session_event_reader(_settings())
        assert kind == "noop"
        assert isinstance(reader, _NoopSessionEventReader)

    async def test_stream_io_wins_when_both_capabilities_present(self):
        """Tier ordering matters: Stream.io is the production target, Redis
        the compose-dev / prod-without-Stream.io fallback."""
        reader, kind = select_session_event_reader(
            _settings(stream_api_key="k", stream_api_secret="s", redis_url="redis://localhost:6379/0")
        )
        assert kind == "stream_io"
        assert isinstance(reader, StreamIoSessionEventReader)


class TestInstallation:
    def test_install_replaces_active_reader_with_redis(self, caplog):
        with caplog.at_level("INFO", logger="app.use_cases.session.event_replay_dispatch"):
            kind = install_session_event_reader(_settings(redis_url="redis://localhost:6379/0"))
        assert kind == "redis"
        assert isinstance(get_session_event_reader(), RedisSessionEventReader)

    def test_install_logs_decision_once(self, caplog):
        with caplog.at_level("INFO", logger="app.use_cases.session.event_replay_dispatch"):
            install_session_event_reader(_settings(redis_url="redis://localhost:6379/0"))
        info_messages = [r.message for r in caplog.records if r.levelno >= 20]
        assert any("selected adapter: redis" in m for m in info_messages)

    def test_install_with_no_capabilities_keeps_noop_default(self):
        kind = install_session_event_reader(_settings())
        assert kind == "noop"
        assert isinstance(get_session_event_reader(), _NoopSessionEventReader)
