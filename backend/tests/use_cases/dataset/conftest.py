import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import TransformRecord, DatasetRecord, ProjectRecord, PipelineRunRecord  # noqa: F401


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project, two datasets, and a transform."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
    )
    db_session.add(project)

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

    transform1 = TransformRecord(
        id="transform-001",
        dataset_id="dataset-001",
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        status='enabled',
    )
    db_session.add(transform1)

    await db_session.commit()

    return db_session
