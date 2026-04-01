"""Test fixtures for session use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata import ProjectMemoryRecord, ProjectRecord, SessionRecord
from tests.uuidv7_fixtures import (
    MEMORY_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    SESSION_1,
    SESSION_2,
    USER_1,
    USER_2,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")
OTHER_USER = AuthUser(id=USER_2, email="other@example.com", org_id=ORG_1, name="Other User")
OTHER_ORG_USER = AuthUser(id=USER_2, email="other@example.com", org_id=ORG_OTHER, name="Other Org User")


@pytest.fixture(autouse=True)
def auth_user():
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project, memory, and sessions."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    db_session.add(project)

    memory = ProjectMemoryRecord(
        id=MEMORY_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        stream_channel_id="proj_test_channel_1",
    )
    db_session.add(memory)

    session1 = SessionRecord(
        id=SESSION_1,
        memory_id=MEMORY_1,
        stream_thread_id="thread_001",
        owner_id=USER_1,
        title="First Session",
        org_id=ORG_1,
    )
    session2 = SessionRecord(
        id=SESSION_2,
        memory_id=MEMORY_1,
        stream_thread_id="thread_002",
        owner_id=USER_2,
        title="Second Session",
        org_id=ORG_1,
    )
    db_session.add(session1)
    db_session.add(session2)

    await db_session.commit()
    return db_session
