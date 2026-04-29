"""Tests for the SessionEventReader port + classifier + noop default."""

import logging

import pytest

from app.use_cases.session.event_replay import (
    DOMAIN_EVENT_TYPES,
    EventsPage,
    _NoopSessionEventReader,
    is_domain_event,
    noop_session_event_reader,
)


@pytest.fixture(autouse=True)
def _reset_noop_warning_state():
    """The noop reader emits a WARNING once per process (class-level guard).
    Reset between tests so warning behavior is deterministic."""
    _NoopSessionEventReader._warned = False
    yield
    _NoopSessionEventReader._warned = False


class TestIsDomainEvent:
    @pytest.mark.parametrize(
        "event_type",
        sorted(DOMAIN_EVENT_TYPES),
    )
    def test_domain_event_types_are_classified_as_domain(self, event_type: str):
        assert is_domain_event({"type": event_type}) is True

    @pytest.mark.parametrize(
        "event_type",
        ["sort_directive", "filter_directive", "filters_cleared"],
    )
    def test_ui_directive_types_are_not_classified_as_domain(self, event_type: str):
        """ADR-014: UI directives are out of replay scope."""
        assert is_domain_event({"type": event_type}) is False

    def test_unknown_type_is_not_classified_as_domain(self):
        assert is_domain_event({"type": "made_up_event"}) is False

    def test_missing_type_is_not_classified_as_domain(self):
        assert is_domain_event({}) is False

    def test_assistant_text_delta_excluded_per_adr_014(self):
        """Mirror agent-side classifier — text streaming is not a domain
        event. (See agent/lib/chat/threadPersister.ts)."""
        assert is_domain_event({"type": "assistant_text_delta"}) is False


class TestNoopSessionEventReader:
    async def test_returns_empty_page_for_any_input(self):
        page = await noop_session_event_reader.get_events(stream_thread_id="thread_xyz", since=None, limit=100)
        assert page == EventsPage(events=[], next_cursor=None, has_more=False)

    async def test_returns_empty_even_with_cursor(self):
        page = await noop_session_event_reader.get_events(stream_thread_id="thread_xyz", since="some-cursor", limit=10)
        assert page.events == []
        assert page.next_cursor is None
        assert page.has_more is False


class TestNoopMisconfigurationWarning:
    """The noop default is the production wiring until a real Stream.io reader
    lands. A misconfigured deployment (no adapter wired) is otherwise silent —
    callers see contract-compliant empty pages. Surface it as a WARNING the
    first time the noop is exercised in a process so ops/tests can detect the
    drift."""

    async def test_emits_warning_on_first_call(self, caplog: pytest.LogCaptureFixture):
        with caplog.at_level(logging.WARNING, logger="app.use_cases.session.event_replay"):
            await noop_session_event_reader.get_events(stream_thread_id="t", since=None, limit=10)

        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
        assert "noop default in use" in warnings[0].message

    async def test_warning_emitted_only_once_per_process(self, caplog: pytest.LogCaptureFixture):
        with caplog.at_level(logging.WARNING, logger="app.use_cases.session.event_replay"):
            await noop_session_event_reader.get_events(stream_thread_id="t", since=None, limit=10)
            await noop_session_event_reader.get_events(stream_thread_id="t", since="c", limit=5)
            await noop_session_event_reader.get_events(stream_thread_id="t2", since=None, limit=1)

        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert len(warnings) == 1
