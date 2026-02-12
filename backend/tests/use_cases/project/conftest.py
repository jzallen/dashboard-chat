"""Test fixtures for project use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.metadata import DatasetRecord, ProjectRecord
# Import PipelineRunRecord to ensure mapper is configured (TransformRecord has relationship to it)
from app.repositories.metadata import PipelineRunRecord  # noqa: F401


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with two projects, one with datasets."""
    project1 = ProjectRecord(
        id="project-001",
        name="Test Project",
        description="A test project",
    )
    project2 = ProjectRecord(
        id="project-002",
        name="Another Project",
        description=None,
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
