"""Test fixtures for assistant-audit use cases.

Seeds a project (ORG_1) with a dataset, plus a SECOND project in ORG_OTHER so
org-scoping is observable. Individual tests add the ``assistant_audit_entries``
and ``transforms`` rows they need.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_OTHER,
)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed two projects (one per org) and a dataset under PROJECT_1."""
    set_session(db_session)
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other Org Project", org_id=ORG_OTHER))
    db_session.add(
        DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Test Dataset",
            schema_config={"fields": {}},
        )
    )
    await db_session.commit()
    return db_session
