"""Tests for get_organization use case.

The use case now assembles the full OrgSettings response from the org record
plus the current AuthUser: real name/slug/region/defaults from the record, a
self-only members list from the auth user, and static plan/seats stubs.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.use_cases.organization import get_organization
from tests.use_cases.organization.conftest import TEST_USER, TEST_USER_WITH_ORG
from tests.uuidv7_fixtures import ORG_1, ORG_2, USER_3


class TestGetOrganization:
    """Tests for get_organization workflow."""

    async def test_get_org_returns_full_org_settings_shape(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_organization(user=TEST_USER_WITH_ORG)

        match result:
            case Success(data):
                assert data == {
                    "id": ORG_1,
                    "name": "Test Organization",
                    "slug": "acme",
                    "region": "eu-west-1",
                    "plan": "free",
                    "seats": 5,
                    "used_seats": 1,
                    "created_at": data["created_at"],
                    "members": [
                        {
                            "name": "Org User",
                            "email": "orguser@example.com",
                            "role": "owner",
                        }
                    ],
                    "defaults": {
                        "engine": "trino",
                        "materialization": "table",
                        "model_prefix": "acme_",
                    },
                }
            case Failure(error):
                pytest.fail(f"Expected org settings dict, got: {error}")

    async def test_members_is_self_only_from_auth_user(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_organization(user=TEST_USER_WITH_ORG)

        data = result.unwrap()
        assert data["members"] == [{"name": "Org User", "email": "orguser@example.com", "role": "owner"}]
        assert data["used_seats"] == 1

    async def test_member_name_falls_back_to_email_when_auth_user_name_missing(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        user = AuthUser(id=USER_3, email="noname@example.com", org_id=ORG_1, name=None)

        result = await get_organization(user=user)

        data = result.unwrap()
        assert data["members"] == [{"name": "noname@example.com", "email": "noname@example.com", "role": "owner"}]

    async def test_slug_falls_back_to_slugified_name_when_column_null(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        user = AuthUser(id=USER_3, email="other@example.com", org_id=ORG_2, name="Other User")

        result = await get_organization(user=user)

        data = result.unwrap()
        # ORG_2 ("Globex Heavy Industries") has a null slug column → slugified name.
        assert data["slug"] == "globex-heavy-industries"
        # Region/defaults fall to the server-default-equivalent values from the record.
        assert data["region"] == "us-east-1"
        assert data["defaults"] == {
            "engine": "duckdb",
            "materialization": "view",
            "model_prefix": "",
        }

    async def test_get_org_when_user_has_no_org_returns_none(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_organization(user=TEST_USER)

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"Expected None, got: {error}")

    async def test_get_org_when_org_id_nonexistent_returns_none(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await get_organization(
            user=AuthUser(
                id=USER_3,
                email="ghost@example.com",
                org_id="nonexistent-org",
                name="Ghost User",
            )
        )

        match result:
            case Success(data):
                assert data is None
            case Failure(error):
                pytest.fail(f"Expected None, got: {error}")
