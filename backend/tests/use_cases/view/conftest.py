"""Test fixtures for view use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord, ViewRecord
from tests.uuidv7_fixtures import DATASET_1, ORG_1, PROJECT_1, VIEW_1


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and a dataset."""
    set_session(db_session)
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    db_session.add(project)
    dataset = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Test Dataset",
        schema_config={"fields": {}},
    )
    db_session.add(dataset)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_with_view(seeded_db: AsyncSession):
    """Seed the database with a project, dataset, and a view."""
    view = ViewRecord(
        id=VIEW_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        name="Existing View",
        sql_definition="SELECT * FROM source",
        source_refs=[{"id": DATASET_1, "type": "dataset"}],
    )
    seeded_db.add(view)
    await seeded_db.commit()
    return seeded_db
