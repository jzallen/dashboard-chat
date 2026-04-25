"""Characterization tests for Session operations on MetadataRepository.

Pins behavior for create/get/update/list_sessions. list_sessions uses a
COMPOSITE keyset cursor encoding (last_active_at, id), so tests must
cover the tie-breaking behavior when multiple sessions share the same
last_active_at timestamp.
"""

from datetime import datetime, timedelta

from app.repositories.metadata import SessionRecord
from tests.uuidv7_fixtures import (
    MEMORY_1,
    ORG_1,
    ORG_OTHER,
    SESSION_1,
    SESSION_2,
    SESSION_3,
    USER_1,
)


class TestCreateSession:
    async def test_returns_dict_with_generated_id_and_timestamps(self, repo_with_memory):
        result = await repo_with_memory.create_session(
            memory_id=MEMORY_1,
            stream_thread_id="thread-xyz",
            owner_id=USER_1,
            org_id=ORG_1,
            title="My Session",
        )
        assert result["memory_id"] == MEMORY_1
        assert result["stream_thread_id"] == "thread-xyz"
        assert result["owner_id"] == USER_1
        assert result["org_id"] == ORG_1
        assert result["title"] == "My Session"
        assert result["id"] is not None
        assert result["created_at"] is not None
        assert result["last_active_at"] is not None

    async def test_title_is_optional(self, repo_with_memory):
        result = await repo_with_memory.create_session(
            memory_id=MEMORY_1,
            stream_thread_id="thread-anon",
            owner_id=USER_1,
            org_id=ORG_1,
        )
        assert result["title"] is None


class TestGetSession:
    async def test_returns_dict_when_found(self, repo_with_memory):
        created = await repo_with_memory.create_session(
            memory_id=MEMORY_1,
            stream_thread_id="t1",
            owner_id=USER_1,
            org_id=ORG_1,
            title="S1",
        )
        fetched = await repo_with_memory.get_session(created["id"])
        assert fetched is not None
        assert fetched["id"] == created["id"]
        assert fetched["title"] == "S1"

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_session("nonexistent-id") is None


class TestUpdateSession:
    async def test_applies_update_data_and_returns_dict(self, repo_with_memory):
        created = await repo_with_memory.create_session(
            memory_id=MEMORY_1,
            stream_thread_id="t1",
            owner_id=USER_1,
            org_id=ORG_1,
            title="Old",
        )
        result = await repo_with_memory.update_session(created["id"], {"title": "New"})
        assert result is not None
        assert result["title"] == "New"

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.update_session("nonexistent-id", {"title": "X"}) is None


class TestListSessions:
    async def test_returns_empty_when_no_sessions(self, repo_with_memory):
        items, cursor, has_more = await repo_with_memory.list_sessions(memory_id=MEMORY_1, org_id=ORG_1)
        assert items == []
        assert cursor is None
        assert has_more is False

    async def test_filters_by_memory_and_org(self, repo_with_memory, db_session):
        # Session in the target memory/org
        mine = SessionRecord(
            id=SESSION_1,
            memory_id=MEMORY_1,
            stream_thread_id="mine",
            owner_id=USER_1,
            org_id=ORG_1,
        )
        # Session in a DIFFERENT org — must be excluded
        other_org = SessionRecord(
            id=SESSION_2,
            memory_id=MEMORY_1,
            stream_thread_id="other-org",
            owner_id=USER_1,
            org_id=ORG_OTHER,
        )
        db_session.add(mine)
        db_session.add(other_org)
        await db_session.commit()

        items, _, _ = await repo_with_memory.list_sessions(memory_id=MEMORY_1, org_id=ORG_1)
        ids = {item["id"] for item in items}
        assert ids == {SESSION_1}

    async def test_orders_by_last_active_at_desc(self, repo_with_memory, db_session):
        base = datetime(2026, 1, 1, 12, 0, 0)
        s_oldest = SessionRecord(
            id=SESSION_1,
            memory_id=MEMORY_1,
            stream_thread_id="t1",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=base,
        )
        s_newest = SessionRecord(
            id=SESSION_2,
            memory_id=MEMORY_1,
            stream_thread_id="t2",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=base + timedelta(hours=2),
        )
        s_middle = SessionRecord(
            id=SESSION_3,
            memory_id=MEMORY_1,
            stream_thread_id="t3",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=base + timedelta(hours=1),
        )
        db_session.add(s_oldest)
        db_session.add(s_newest)
        db_session.add(s_middle)
        await db_session.commit()

        items, _, _ = await repo_with_memory.list_sessions(memory_id=MEMORY_1, org_id=ORG_1)
        assert [s["id"] for s in items] == [SESSION_2, SESSION_3, SESSION_1]

    async def test_composite_cursor_pagination_with_same_last_active_at(self, repo_with_memory, db_session):
        # Three sessions with IDENTICAL last_active_at — exercises the
        # composite (last_active_at, id) keyset tie-breaker. Order becomes
        # id-desc within equal timestamps.
        same_ts = datetime(2026, 2, 1, 10, 0, 0)
        s1 = SessionRecord(
            id=SESSION_1,
            memory_id=MEMORY_1,
            stream_thread_id="t1",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=same_ts,
        )
        s2 = SessionRecord(
            id=SESSION_2,
            memory_id=MEMORY_1,
            stream_thread_id="t2",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=same_ts,
        )
        s3 = SessionRecord(
            id=SESSION_3,
            memory_id=MEMORY_1,
            stream_thread_id="t3",
            owner_id=USER_1,
            org_id=ORG_1,
            last_active_at=same_ts,
        )
        db_session.add(s1)
        db_session.add(s2)
        db_session.add(s3)
        await db_session.commit()

        # Page 1: limit=2, order is id desc within same ts => [S3, S2]
        items_p1, cursor_p1, has_more_p1 = await repo_with_memory.list_sessions(
            memory_id=MEMORY_1, org_id=ORG_1, limit=2
        )
        assert [s["id"] for s in items_p1] == [SESSION_3, SESSION_2]
        assert has_more_p1 is True
        assert cursor_p1 is not None

        # Page 2: remaining [S1], no more
        items_p2, cursor_p2, has_more_p2 = await repo_with_memory.list_sessions(
            memory_id=MEMORY_1, org_id=ORG_1, cursor=cursor_p1, limit=2
        )
        assert [s["id"] for s in items_p2] == [SESSION_1]
        assert has_more_p2 is False
        assert cursor_p2 is None
