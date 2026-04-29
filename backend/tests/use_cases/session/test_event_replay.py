"""Tests for the SessionEventReader port + classifier + noop default."""

import pytest

from app.use_cases.session.event_replay import (
    DOMAIN_EVENT_TYPES,
    EventsPage,
    is_domain_event,
    noop_session_event_reader,
)


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
