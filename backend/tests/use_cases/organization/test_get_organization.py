"""Tests for get_organization use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.use_cases.organization import get_organization
from app.repositories import set_session
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

from tests.uuidv7_fixtures import ORG_1, USER_3

from .conftest import TEST_USER, TEST_USER_WITH_ORG


class TestGetOrganization:
    """Tests for get_organization workflow."""

    async def test_returns_org_for_user_with_org(self, seeded_db: AsyncSession):
        """get_organization should return org dict for a user who has an org."""
        set_session(seeded_db)
        set_auth_user(TEST_USER_WITH_ORG)

        result = await get_organization()

        match result:
            case Success(data):
                assert data == {
                    "id": ORG_1,
                    "name": "Test Organization",
                    "created_at": data["created_at"],
                    "updated_at": data["updated_at"],
                }
            case Failure(error):
                pytest.fail(f"get_organization should return org, got: {error}")

    async def test_returns_none_for_user_without_org(self, seeded_db: AsyncSession):
        """get_organization should return None for a user without an org_id."""
        set_session(seeded_db)
        # TEST_USER has org_id=None (set by conftest autouse fixture)

        result = await get_organization()

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"get_organization should succeed with None, got: {error}")

    async def test_returns_none_for_nonexistent_org(self, seeded_db: AsyncSession):
        """get_organization should return None when org_id points to missing org."""
        set_session(seeded_db)
        set_auth_user(AuthUser(
            id=USER_3,
            email="ghost@example.com",
            org_id="nonexistent-org",
            name="Ghost User",
        ))

        result = await get_organization()

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"get_organization should succeed with None, got: {error}")
