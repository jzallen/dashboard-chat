"""Test fixtures for SQL access use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord, ExternalAccessRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

from tests.uuidv7_fixtures import (
    USER_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_EMPTY,
    PROJECT_OTHER,
    DATASET_1,
    DATASET_2,
    DATASET_OTHER,
    EA_1,
    EA_DISABLED,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all SQL access tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and two datasets."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        description="A test project",
        org_id=ORG_1,
    )
    db_session.add(project)

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


@pytest.fixture
async def seeded_db_with_access(seeded_db: AsyncSession):
    """Seed the database with a project, datasets, and an enabled external access record."""
    record = ExternalAccessRecord(
        id=EA_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
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
        id=EA_DISABLED,
        project_id=PROJECT_1,
        org_id=ORG_1,
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
        id=PROJECT_EMPTY,
        name="Empty Project",
        org_id=ORG_1,
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_other_org(db_session: AsyncSession):
    """Seed the database with a project owned by a different org."""
    project = ProjectRecord(
        id=PROJECT_OTHER,
        name="Other Org Project",
        org_id=ORG_OTHER,
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id=DATASET_OTHER,
        project_id=PROJECT_OTHER,
        name="Other Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)
    await db_session.commit()
    return db_session
