"""Tests for get_organization use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from app.repositories import set_session
from app.use_cases.organization import get_organization
from tests.uuidv7_fixtures import ORG_1, USER_3

from .conftest import TEST_USER_WITH_ORG


class TestGetOrganization:
    """Tests for get_organization workflow."""

    async def test_get_org_when_user_has_org_returns_org_dict(self, seeded_db: AsyncSession):
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
                pytest.fail(f"Expected org dict, got: {error}")

    async def test_get_org_when_user_has_no_org_returns_none(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_organization()

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"Expected None, got: {error}")

    async def test_get_org_when_org_id_nonexistent_returns_none(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        set_auth_user(
            AuthUser(
                id=USER_3,
                email="ghost@example.com",
                org_id="nonexistent-org",
                name="Ghost User",
            )
        )

        result = await get_organization()

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"Expected None, got: {error}")
