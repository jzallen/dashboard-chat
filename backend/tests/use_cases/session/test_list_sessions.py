"""Tests for list_sessions use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.session.list_sessions import list_sessions
from tests.uuidv7_fixtures import PROJECT_1

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
