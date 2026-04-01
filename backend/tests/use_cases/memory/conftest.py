"""Test fixtures for memory use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata import ProjectMemoryRecord, ProjectRecord
from tests.uuidv7_fixtures import (
    MEMORY_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_2,
    USER_1,
    USER_2,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")
OTHER_ORG_USER = AuthUser(id=USER_2, email="other@example.com", org_id=ORG_OTHER, name="Other User")


@pytest.fixture(autouse=True)
def auth_user():
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and its memory."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    project2 = ProjectRecord(
        id=PROJECT_2,
        name="No Memory Project",
        org_id=ORG_1,
    )
    db_session.add(project)
    db_session.add(project2)

    memory = ProjectMemoryRecord(
        id=MEMORY_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        stream_channel_id="proj_test_channel_1",
    )
    db_session.add(memory)

    await db_session.commit()
    return db_session
