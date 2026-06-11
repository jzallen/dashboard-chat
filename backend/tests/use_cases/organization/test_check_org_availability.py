"""Tests for check_org_name_availability use case (CDO-S2, ADR-050 §b).

Thin read over the existing unique-name point lookup: a name is available iff
``get_organization_by_name`` returns None.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.organization import check_org_name_availability, create_organization
from tests.use_cases.organization.conftest import TEST_USER


class TestCheckOrgNameAvailability:
    """Name-availability lookup behaviors."""

    async def test_free_name_is_available(self, db_session: AsyncSession):
        set_session(db_session)

        result = await check_org_name_availability(name="Unclaimed Co")

        match result:
            case Success(data):
                assert data == {"available": True}
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_taken_name_is_unavailable(self, db_session: AsyncSession):
        set_session(db_session)

        created = await create_organization(name="Acme Corp", user=TEST_USER)
        assert isinstance(created, Success), f"setup create failed: {created}"

        result = await check_org_name_availability(name="Acme Corp")

        match result:
            case Success(data):
                assert data == {"available": False}
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
