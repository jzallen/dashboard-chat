"""Tests for list_session_events use case (dc-x3y.3.2 / Epic C — replay endpoint).

Drives the read-side of the C.1 / C.2 pair through a fake SessionEventReader.
The production reader is a noop (no-op replay) until Stream.io credentials are
wired through env on the Python side; these tests exercise the protocol with
an in-memory adapter that captures the cursor + limit it was called with so
the use case's contract can be verified independently of the durable backend.
"""

import logging
from dataclasses import dataclass, field

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.session.event_replay import (
    EventsPage,
    SessionEventReader,
    _NoopSessionEventReader,
)
from app.use_cases.session.exceptions import SessionNotFound
from app.use_cases.session.list_session_events import (
    MAX_EVENTS_PER_PAGE,
    list_session_events,
)
from tests.uuidv7_fixtures import SESSION_1

from .conftest import OTHER_ORG_USER, TEST_USER

# stream_thread_id seeded in conftest for SESSION_1.
SESSION_1_THREAD = "thread_001"


@dataclass
class _FakeReader:
    """In-memory SessionEventReader for tests.

    Records the (thread_id, since, limit) it was called with so cursor passing
    can be asserted at the protocol level. Stores a list of events keyed by an
    integer index used as cursor (cursor = "<int>"; "" / None = from start).
    """

    events: list[dict] = field(default_factory=list)
    last_call: dict | None = None

    async def get_events(
        self,
        stream_thread_id: str,
        since: str | None,
        limit: int,
    ) -> EventsPage:
        self.last_call = {
            "thread_id": stream_thread_id,
            "since": since,
            "limit": limit,
        }
        start_idx = 0 if since in (None, "", "0") else int(since) + 1
        slice_ = self.events[start_idx : start_idx + limit]
        end_idx = start_idx + len(slice_)
        has_more = end_idx < len(self.events)
        next_cursor = str(end_idx - 1) if has_more and slice_ else None
        return EventsPage(events=slice_, next_cursor=next_cursor, has_more=has_more)


def _row_added(idx: int) -> dict:
    return {"type": "row_added", "row": {"idx": idx}}


def _ui_directive(idx: int) -> dict:
    return {"type": "sort_directive", "idx": idx}


class TestListSessionEvents:
    async def test_empty_session_returns_empty_page(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        reader: SessionEventReader = _FakeReader(events=[])

        result = await list_session_events(
            SESSION_1,
            user=TEST_USER,
            since=None,
            limit=100,
            event_reader=reader,
        )

        match result:
            case Success(data):
                assert data == {
                    "session_id": SESSION_1,
                    "events": [],
                    "next_cursor": None,
                    "has_more": False,
                }
            case Failure(err):
                pytest.fail(f"Expected success, got: {err}")

    async def test_replay_since_cursor_returns_events_in_order(self, seeded_db: AsyncSession):
        """Bead test invariant: client disconnects after seeing event N,
        reconnects with since=N, receives events N+1..M in order."""
        set_session(seeded_db)
        events = [_row_added(i) for i in range(5)]
        reader = _FakeReader(events=events)

        result = await list_session_events(
            SESSION_1,
            user=TEST_USER,
            since="1",  # client has seen events[0] and events[1]
            limit=100,
            event_reader=reader,
        )

        match result:
            case Success(data):
                assert data["events"] == events[2:5]
                assert data["has_more"] is False
                assert data["next_cursor"] is None
                assert reader.last_call == {
                    "thread_id": SESSION_1_THREAD,
                    "since": "1",
                    "limit": 100,
                }
            case Failure(err):
                pytest.fail(f"Expected success, got: {err}")

    async def test_pagination_returns_has_more_and_next_cursor(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        events = [_row_added(i) for i in range(10)]
        reader = _FakeReader(events=events)

        first = await list_session_events(SESSION_1, user=TEST_USER, since=None, limit=4, event_reader=reader)
        match first:
            case Success(data):
                assert len(data["events"]) == 4
                assert data["events"] == events[0:4]
                assert data["has_more"] is True
                assert data["next_cursor"] == "3"
                cursor = data["next_cursor"]
            case Failure(err):
                pytest.fail(f"Expected success, got: {err}")

        # Following the cursor returns the remainder.
        second = await list_session_events(SESSION_1, user=TEST_USER, since=cursor, limit=4, event_reader=reader)
        match second:
            case Success(data):
                assert data["events"] == events[4:8]
                assert data["has_more"] is True
                assert data["next_cursor"] == "7"
            case Failure(err):
                pytest.fail(f"Expected success, got: {err}")

    async def test_ui_directives_filtered_out(self, seeded_db: AsyncSession):
        """Per ADR-014, UI directives are out of replay scope. Even if a future
        reader implementation surfaces them (or one leaks into the durable
        store), the use case must filter them defense-in-depth."""
        set_session(seeded_db)
        mixed = [
            _row_added(0),
            _ui_directive(1),
            _row_added(2),
            _ui_directive(3),
            {"type": "turn_done", "reason": "stop"},
        ]
        reader = _FakeReader(events=mixed)

        result = await list_session_events(SESSION_1, user=TEST_USER, since=None, limit=100, event_reader=reader)

        match result:
            case Success(data):
                returned_types = [e["type"] for e in data["events"]]
                assert returned_types == ["row_added", "row_added", "turn_done"]
            case Failure(err):
                pytest.fail(f"Expected success, got: {err}")

    async def test_unknown_session_returns_session_not_found(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await list_session_events(
            "00000000-0000-0000-0000-000000000000",
            user=TEST_USER,
            event_reader=_FakeReader(),
        )

        match result:
            case Success(_):
                pytest.fail("Expected failure for unknown session")
            case Failure(err):
                assert isinstance(err, SessionNotFound)

    async def test_cross_org_access_returns_session_not_found(self, seeded_db: AsyncSession):
        """Existence is not leaked — cross-org access collapses to the same
        404 as an unknown session id."""
        set_session(seeded_db)
        result = await list_session_events(SESSION_1, user=OTHER_ORG_USER, event_reader=_FakeReader())

        match result:
            case Success(_):
                pytest.fail("Expected SessionNotFound for cross-org access")
            case Failure(err):
                assert isinstance(err, SessionNotFound)

    async def test_adapter_override_suppresses_noop_warning(
        self, seeded_db: AsyncSession, caplog: pytest.LogCaptureFixture
    ):
        """Per the bead acceptance: passing a real `event_reader=` adapter
        must not trigger the noop misconfiguration warning."""
        set_session(seeded_db)
        _NoopSessionEventReader._warned = False
        try:
            with caplog.at_level(logging.WARNING, logger="app.use_cases.session.event_replay"):
                await list_session_events(
                    SESSION_1,
                    user=TEST_USER,
                    event_reader=_FakeReader(events=[]),
                )

            warnings = [
                r for r in caplog.records if r.levelno == logging.WARNING and "noop default in use" in r.message
            ]
            assert warnings == []
        finally:
            _NoopSessionEventReader._warned = False

    async def test_limit_clamped_to_max(self, seeded_db: AsyncSession):
        """A pathological limit value is clamped to MAX_EVENTS_PER_PAGE so a
        rogue caller cannot force a huge pull through the fake reader."""
        set_session(seeded_db)
        reader = _FakeReader(events=[])

        await list_session_events(
            SESSION_1,
            user=TEST_USER,
            limit=10_000,
            event_reader=reader,
        )

        assert reader.last_call is not None
        assert reader.last_call["limit"] == MAX_EVENTS_PER_PAGE
