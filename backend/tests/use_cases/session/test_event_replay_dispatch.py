"""Tests for the SessionEventReader dispatch helper (Epic F.2 — ADR-018 (supersedes ADR-017)).

Pins the capability-presence routing rule (post Stream.io deletion):
  REDIS_URL set → redis
  unset         → noop

ENV-name-based dispatch (NODE_ENV / APP_ENV / etc.) is forbidden by ADR-018 (supersedes ADR-017);
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
    ReaderKind,
    install_session_event_reader,
    select_session_event_reader,
)
from app.use_cases.session.redis_session_event_reader import RedisSessionEventReader


@pytest.fixture(autouse=True)
def _restore_active_reader():
    """install_session_event_reader mutates module state; restore afterwards
    so tests don't leak."""
    original = event_replay._active_reader
    yield
    event_replay._active_reader = original


def _settings(**overrides) -> Settings:
    base = {"redis_url": ""}
    base.update(overrides)
    return Settings(**base)


class TestSelection:
    """`select_session_event_reader` is sync. Two-tier dispatch: redis or noop."""

    def test_picks_redis_when_redis_url_set(self):
        reader, kind = select_session_event_reader(_settings(redis_url="redis://localhost:6379/0"))
        assert kind == "redis"
        assert isinstance(reader, RedisSessionEventReader)

    def test_picks_noop_when_nothing_configured(self):
        reader, kind = select_session_event_reader(_settings())
        assert kind == "noop"
        assert isinstance(reader, _NoopSessionEventReader)

    def test_reader_kind_has_no_stream_io_variant(self):
        """Pin the post-deletion contract: ReaderKind is two-tier only.

        After Phase 1 of the Stream.io→Redis migration, "stream_io" is no
        longer a valid ReaderKind. This is the regression net for anyone
        re-introducing the tier."""
        # Literal["redis", "noop"] — order is part of the contract surface
        assert set(ReaderKind.__args__) == {"redis", "noop"}
        assert "stream_io" not in ReaderKind.__args__


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
