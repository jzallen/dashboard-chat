import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

TEST_USER = AuthUser(id="test-user-001", email="test@example.com", org_id="test-org-001", name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all upload tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and dataset for upload tests."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
        org_id="test-org-001",
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Existing Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    await db_session.commit()

    return db_session
