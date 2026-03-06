import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata import DatasetRecord, ProjectRecord, TransformRecord
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, ORG_1, PROJECT_1, TRANSFORM_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all dataset tests."""
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project, two datasets, and a transform."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
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

    transform1 = TransformRecord(
        id=TRANSFORM_1,
        dataset_id=DATASET_1,
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        status="enabled",
    )
    db_session.add(transform1)

    await db_session.commit()

    return db_session
