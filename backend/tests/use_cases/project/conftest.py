"""Test fixtures for project use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

TEST_USER = AuthUser(id="test-user-001", email="test@example.com", org_id="test-org-001", name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all project tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with two projects, one with datasets."""
    project1 = ProjectRecord(
        id="project-001",
        name="Test Project",
        description="A test project",
        org_id="test-org-001",
    )
    project2 = ProjectRecord(
        id="project-002",
        name="Another Project",
        description=None,
        org_id="test-org-001",
    )
    db_session.add(project1)
    db_session.add(project2)

    dataset1 = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    dataset2 = DatasetRecord(
        id="dataset-002",
        storage_path="project-001/dataset-002.parquet",
        project_id="project-001",
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
    )
    db_session.add(dataset1)
    db_session.add(dataset2)

    await db_session.commit()

    return db_session
