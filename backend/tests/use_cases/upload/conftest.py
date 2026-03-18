import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.metadata import DatasetRecord, ProjectRecord
from tests.uuidv7_fixtures import DATASET_1, ORG_1, PROJECT_1


@pytest.fixture(autouse=True)
def auto_mock_s3(mock_s3):
    """Auto-use S3 mocking for upload tests."""
    yield mock_s3


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and dataset for upload tests."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Existing Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    await db_session.commit()

    return db_session
