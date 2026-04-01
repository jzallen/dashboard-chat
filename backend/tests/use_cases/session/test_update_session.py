"""Tests for update_session use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.session.exceptions import SessionAccessDenied, SessionNotFound
from app.use_cases.session.update_session import update_session
from tests.uuidv7_fixtures import SESSION_1

from .conftest import OTHER_ORG_USER, OTHER_USER, TEST_USER


class TestUpdateSession:
    async def test_owner_can_update_title(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await update_session(SESSION_1, update_data={"title": "New Title"}, user=TEST_USER)

        match result:
            case Success(data):
                assert data["title"] == "New Title"
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_non_owner_cannot_update(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # SESSION_1 is owned by USER_1, OTHER_USER is USER_2
        result = await update_session(SESSION_1, update_data={"title": "Hacked"}, user=OTHER_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for non-owner")
            case Failure(error):
                assert isinstance(error, SessionAccessDenied)

    async def test_nonexistent_session_fails(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await update_session("nonexistent-id", update_data={"title": "Test"}, user=TEST_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for nonexistent session")
            case Failure(error):
                assert isinstance(error, SessionNotFound)

    async def test_cross_org_user_cannot_update_session(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # OTHER_ORG_USER is in a different org than the session
        result = await update_session(SESSION_1, update_data={"title": "Cross-org"}, user=OTHER_ORG_USER)

        match result:
            case Success(_):
                pytest.fail("Expected failure for cross-org user")
            case Failure(error):
                assert isinstance(error, SessionNotFound)

    async def test_ignores_disallowed_fields(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        result = await update_session(
            SESSION_1,
            update_data={"title": "Updated", "owner_id": "hacker", "org_id": "hacked"},
            user=TEST_USER,
        )

        match result:
            case Success(data):
                assert data["title"] == "Updated"
                assert data["owner_id"] == TEST_USER.id  # unchanged
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
