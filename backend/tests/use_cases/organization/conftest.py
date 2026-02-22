"""Test fixtures for organization use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import ProjectRecord, OrganizationRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1, USER_2

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=None, name="Test User")
TEST_USER_WITH_ORG = AuthUser(id=USER_2, email="orguser@example.com", org_id=ORG_1, name="Org User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user (no org) for organization tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with an org and a project."""
    org = OrganizationRecord(
        id=ORG_1,
        name="Test Organization",
    )
    db_session.add(org)

    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        description="A test project",
        org_id=ORG_1,
        created_by=USER_2,
    )
    db_session.add(project)

    await db_session.commit()

    return db_session
