import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import TransformRecord, DatasetRecord, ProjectRecord
from app.repositories.outbox.outbox_record import OutboxRecord
from app.auth.context import set_auth_user
from app.auth.types import AuthUser

from tests.uuidv7_fixtures import (
    USER_1,
    ORG_1,
    PROJECT_1,
    DATASET_1,
    TRANSFORM_1,
    TRANSFORM_2,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all transform tests."""
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project, dataset, and transforms."""
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    transform = TransformRecord(
        id=TRANSFORM_1,
        dataset_id=DATASET_1,
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        status='enabled',
    )
    db_session.add(transform)

    transform2 = TransformRecord(
        id=TRANSFORM_2,
        dataset_id=DATASET_1,
        name="Filter Inactive",
        description="Filter for inactive records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'inactive'",
        status='enabled',
    )
    db_session.add(transform2)

    await db_session.commit()

    return db_session
