"""Tests for list_sessions use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import ProjectRecord
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.session.list_sessions import list_sessions
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, PROJECT_2

from .conftest import OTHER_ORG_USER, TEST_USER


class TestListSessions:
    async def test_lists_sessions_for_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await list_sessions(PROJECT_1, user=TEST_USER)

        match result:
            case Success(data):
                assert len(data["items"]) == 2
                assert data["has_more"] is False
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_lists_sessions_with_pagination(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await list_sessions(PROJECT_1, user=TEST_USER, page_size=1)

        match result:
            case Success(data):
                assert len(data["items"]) == 1
                assert data["has_more"] is True
                assert data["next_cursor"] is not None
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_fails_for_wrong_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await list_sessions(PROJECT_1, user=OTHER_ORG_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for wrong org")
            case Failure(error):
                assert isinstance(error, ProjectNotFound)

    async def test_returns_empty_page_when_project_has_no_memory(self, db_session: AsyncSession):
        """A project that exists but has never had a chat session has no
        project_memory row (it is provisioned lazily on first session creation).

        Listing its sessions must yield an empty page, matching the emptiness
        contract of the sibling views/reports/audit reads — not a ProjectNotFound.
        Project existence and org ownership are already guaranteed upstream by
        the router's authorize_project_access.
        """
        db_session.add(ProjectRecord(id=PROJECT_2, name="Fresh Project", org_id=ORG_1))
        await db_session.commit()
        set_session(db_session)

        result = await list_sessions(PROJECT_2, user=TEST_USER)

        match result:
            case Success(data):
                assert data == {"items": [], "next_cursor": None, "has_more": False, "page_size": 30}
            case Failure(error):
                pytest.fail(f"Expected an empty session page, got: {error!r}")
