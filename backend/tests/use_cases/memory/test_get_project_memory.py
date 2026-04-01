"""Tests for get_project_memory use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.memory.get_project_memory import get_project_memory
from tests.uuidv7_fixtures import PROJECT_1, PROJECT_2

from .conftest import OTHER_ORG_USER, TEST_USER


class TestGetProjectMemory:
    async def test_returns_memory_for_valid_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await get_project_memory(PROJECT_1, user=TEST_USER)

        match result:
            case Success(data):
                assert data["project_id"] == PROJECT_1
                assert data["stream_channel_id"] == "proj_test_channel_1"
                assert data["created_at"] is not None
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_returns_failure_for_project_without_memory(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await get_project_memory(PROJECT_2, user=TEST_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for project without memory")
            case Failure(error):
                assert "not found" in str(error).lower()

    async def test_returns_failure_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await get_project_memory("nonexistent-id", user=TEST_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for nonexistent project")
            case Failure(error):
                assert "not found" in str(error).lower()

    async def test_returns_failure_for_wrong_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await get_project_memory(PROJECT_1, user=OTHER_ORG_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for wrong org")
            case Failure(error):
                assert "not found" in str(error).lower()
