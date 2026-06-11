"""Tests for create_organization use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.use_cases.organization import create_organization
from app.use_cases.organization.exceptions import OrganizationNameTakenError
from tests.use_cases.organization.conftest import TEST_USER, TEST_USER_WITH_ORG


class TestCreateOrganization:
    """Tests for create_organization workflow."""

    async def test_create_org_when_dev_mode_returns_org_record(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Acme Corp", user=TEST_USER)

        match result:
            case Success(data):
                assert data == {
                    "org_id": data["org_id"],
                    "org_name": "Acme Corp",
                }
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_new_org_creates_no_projects(self, db_session: AsyncSession):
        """Inverted per org-onboarding D2: POST /api/orgs no longer auto-creates
        a 'My First Project' — first-project creation belongs solely to the
        project-context creating_project step."""
        set_session(db_session)

        result = await create_organization(name="New Org", user=TEST_USER)

        match result:
            case Success(data):
                org_id = data["org_id"]
                projects = (
                    (await db_session.execute(select(ProjectRecord).where(ProjectRecord.org_id == org_id)))
                    .scalars()
                    .all()
                )
                assert len(projects) == 0
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")

    async def test_create_org_when_user_already_has_org_fails(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Another Org", user=TEST_USER_WITH_ORG)

        match result:
            case Failure(error):
                assert "already belongs to an organization" in str(error)
            case Success(_):
                pytest.fail("Expected failure when user already has an org")

    async def test_create_org_when_name_already_taken_fails(self, db_session: AsyncSession):
        set_session(db_session)

        first = await create_organization(name="Acme Corp", user=TEST_USER)
        assert isinstance(first, Success), f"setup create failed: {first}"

        # Org names are globally unique — a second create with the same name is
        # rejected before insert (TEST_USER.org_id is None, so the user-already-
        # has-org guard does not short-circuit it).
        result = await create_organization(name="Acme Corp", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, OrganizationNameTakenError)
                assert "Acme Corp" in str(error)
            case Success(_):
                pytest.fail("Expected failure when org name is already taken")

    async def test_create_org_when_successful_persists_org_in_db(self, db_session: AsyncSession):
        set_session(db_session)

        result = await create_organization(name="Test Org", user=TEST_USER)

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
                assert org.created_by == TEST_USER.id
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
