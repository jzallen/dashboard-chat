import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import TransformRecord, DatasetRecord, ProjectRecord
from app.repositories.outbox.outbox_record import OutboxRecord


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project, dataset, and transforms."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    transform = TransformRecord(
        id="transform-001",
        dataset_id="dataset-001",
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        status='enabled',
    )
    db_session.add(transform)

    transform2 = TransformRecord(
        id="transform-002",
        dataset_id="dataset-001",
        name="Filter Inactive",
        description="Filter for inactive records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'inactive'",
        status='enabled',
    )
    db_session.add(transform2)

    await db_session.commit()

    return db_session
