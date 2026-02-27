"""Tests for create_organization use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.repositories import set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.use_cases.organization import create_organization

from .conftest import TEST_USER, TEST_USER_WITH_ORG


class TestCreateOrganization:
    """Tests for create_organization workflow."""

    async def test_create_org_when_dev_mode_returns_org_record(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Acme Corp")

        match result:
            case Success(data):
                assert data == {
                    "org_id": data["org_id"],
                    "org_name": "Acme Corp",
                }
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_new_org_creates_default_project(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="New Org")

        match result:
            case Success(data):
                org_id = data["org_id"]
                projects = (
                    (await db_session.execute(select(ProjectRecord).where(ProjectRecord.org_id == org_id)))
                    .scalars()
                    .all()
                )
                assert len(projects) == 1
                assert projects[0].name == "My First Project"
                assert projects[0].created_by == TEST_USER.id
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_user_already_has_org_fails(self, db_session: AsyncSession):
        set_session(db_session)
        set_auth_user(TEST_USER_WITH_ORG)

        result = await create_organization(name="Another Org")

        match result:
            case Failure(error):
                assert "already belongs to an organization" in str(error)
            case Success(_):
                pytest.fail("Expected failure when user already has an org")

    async def test_create_org_when_successful_persists_org_in_db(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Test Org")

        match result:
            case Success(data):
                org_id = data["org_id"]
                assert org_id is not None
                assert len(org_id) > 0
                org = (
                    await db_session.execute(select(OrganizationRecord).where(OrganizationRecord.id == org_id))
                ).scalar_one_or_none()
                assert org is not None
                assert org.name == "Test Org"
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
