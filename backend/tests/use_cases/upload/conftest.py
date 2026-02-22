import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from tests.uuidv7_fixtures import USER_1, ORG_1, PROJECT_1, DATASET_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all upload tests."""
    set_auth_user(TEST_USER)


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
