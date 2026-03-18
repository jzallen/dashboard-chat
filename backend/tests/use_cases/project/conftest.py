"""Test fixtures for project use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata import DatasetRecord, ProjectRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_2,
    ORG_1,
    PROJECT_1,
    PROJECT_2,
    USER_1,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all project tests.

    This autouse fixture ensures every test in the project test suite has
    an authenticated user context. Individual tests may call set_auth_user()
    explicitly for clarity or to override with a different user.
    """
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with two projects, one with datasets."""
    project1 = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        description="A test project",
        org_id=ORG_1,
    )
    project2 = ProjectRecord(
        id=PROJECT_2,
        name="Another Project",
        description=None,
        org_id=ORG_1,
    )
    db_session.add(project1)
    db_session.add(project2)

    dataset1 = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    dataset2 = DatasetRecord(
        id=DATASET_2,
        project_id=PROJECT_1,
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
    )
    db_session.add(dataset1)
    db_session.add(dataset2)

    await db_session.commit()

    return db_session
