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

    async def test_create_org_uses_caller_org_claim_as_row_id(self, db_session: AsyncSession):
        """The caller's org claim (user.org_id ← X-Org-Id) becomes the persisted
        row id verbatim — in workos mode the auth-proxy sets X-Org-Id to the
        freshly-provisioned WorkOS org id (the WorkOS id IS the local id,
        ADR-050 §b). There is NO 'already has an org' guard: a non-None claim is
        the org being persisted, not a rejection trigger."""
        set_session(db_session)

        result = await create_organization(name="Claimed Org", user=TEST_USER_WITH_ORG)

        match result:
            case Success(data):
                assert data["org_id"] == TEST_USER_WITH_ORG.org_id
            case Failure(error):
                pytest.fail(f"Expected success (no no-org guard), got: {error}")

    async def test_create_org_when_name_already_taken_fails(self, db_session: AsyncSession):
        set_session(db_session)

        first = await create_organization(name="Acme Corp", user=TEST_USER)
        assert isinstance(first, Success), f"setup create failed: {first}"

        # Org names are globally unique — a second create with the same name is
        # rejected on the duplicate name before insert.
        result = await create_organization(name="Acme Corp", user=TEST_USER)

        match result:
            case Failure(error):
                assert isinstance(error, OrganizationNameTakenError)
                assert "Acme Corp" in str(error)
            case Success(_):
                pytest.fail("Expected failure when org name is already taken")

    async def test_create_org_generates_id_when_caller_has_no_org_claim(self, db_session: AsyncSession):
        """ADR-050 §b, the two arms of "WorkOS id IS the local id, else generated":
        a caller carrying an org claim (user.org_id) → that id verbatim; a caller
        with org_id=None (dev / non-intercepted) → a backend-generated id."""
        from dataclasses import replace

        set_session(db_session)

        provisioned = "org_workos_provisioned_42"
        claimed_user = replace(TEST_USER, org_id=provisioned)
        with_id = await create_organization(name="Provisioned Org", user=claimed_user)
        without_id = await create_organization(name="Generated Org", user=TEST_USER)  # org_id=None

        match (with_id, without_id):
            case (Success(provided), Success(generated)):
                assert provided["org_id"] == provisioned
                assert generated["org_id"] != provisioned
                assert len(generated["org_id"]) > 0
            case _:
                pytest.fail(f"Expected two successes, got: {with_id}, {without_id}")

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
