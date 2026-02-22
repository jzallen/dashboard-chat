"""Test fixtures for SQL access use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord, ExternalAccessRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

TEST_USER = AuthUser(id="test-user-001", email="test@example.com", org_id="test-org-001", name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all SQL access tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and two datasets."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
        description="A test project",
        org_id="test-org-001",
    )
    db_session.add(project)

    dataset1 = DatasetRecord(
        id="dataset-001",
        storage_path="datasets/project-001/dataset-001/",
        project_id="project-001",
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    dataset2 = DatasetRecord(
        id="dataset-002",
        storage_path="datasets/project-001/dataset-002/",
        project_id="project-001",
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
    )
    db_session.add(dataset1)
    db_session.add(dataset2)

    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_with_access(seeded_db: AsyncSession):
    """Seed the database with a project, datasets, and an enabled external access record."""
    record = ExternalAccessRecord(
        id="ea-001",
        project_id="project-001",
        org_id="test-org-001",
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_password_hash="$2b$12$fakehashfortesting",
        enabled=True,
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_with_disabled_access(seeded_db: AsyncSession):
    """Seed the database with a project, datasets, and a disabled external access record."""
    record = ExternalAccessRecord(
        id="ea-disabled",
        project_id="project-001",
        org_id="test-org-001",
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_password_hash="$2b$12$fakehashfortesting",
        enabled=False,
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_no_datasets(db_session: AsyncSession):
    """Seed the database with a project that has no datasets."""
    project = ProjectRecord(
        id="project-empty",
        name="Empty Project",
        org_id="test-org-001",
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_other_org(db_session: AsyncSession):
    """Seed the database with a project owned by a different org."""
    project = ProjectRecord(
        id="project-other",
        name="Other Org Project",
        org_id="other-org-999",
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id="dataset-other",
        storage_path="datasets/project-other/dataset-other/",
        project_id="project-other",
        name="Other Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)
    await db_session.commit()
    return db_session
