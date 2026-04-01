"""Tests for create_session use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.session.create_session import create_session
from tests.uuidv7_fixtures import PROJECT_1

from .conftest import OTHER_ORG_USER, TEST_USER


class TestCreateSession:
    async def test_creates_session_for_valid_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await create_session(PROJECT_1, user=TEST_USER)

        match result:
            case Success(data):
                assert data["owner_id"] == TEST_USER.id
                assert data["org_id"] == TEST_USER.org_id
                assert data["stream_thread_id"] is not None
                assert data["title"] is None
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_fails_for_wrong_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await create_session(PROJECT_1, user=OTHER_ORG_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for wrong org")
            case Failure(error):
                assert isinstance(error, ProjectNotFound)

    async def test_fails_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await create_session("nonexistent-id", user=TEST_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")
            case Failure(error):
                assert isinstance(error, ProjectNotFound)
