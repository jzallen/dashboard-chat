"""Test fixtures for organization use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from tests.uuidv7_fixtures import ORG_1, ORG_2, PROJECT_1, USER_1, USER_2

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=None, name="Test User")
TEST_USER_WITH_ORG = AuthUser(id=USER_2, email="orguser@example.com", org_id=ORG_1, name="Org User")


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with two orgs and a project.

    ORG_1 carries fully-populated settings columns (real slug/region/defaults).
    ORG_2 leaves slug NULL and relies on the column server-defaults for
    region/defaults, exercising the slug-fallback + default-value path.
    """
    org = OrganizationRecord(
        id=ORG_1,
        name="Test Organization",
        slug="acme",
        region="eu-west-1",
        default_engine="trino",
        default_materialization="table",
        default_model_prefix="acme_",
    )
    db_session.add(org)

    org_no_slug = OrganizationRecord(
        id=ORG_2,
        name="Globex Heavy Industries",
        slug=None,
    )
    db_session.add(org_no_slug)

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
