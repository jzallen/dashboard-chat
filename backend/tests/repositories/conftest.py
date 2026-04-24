"""Shared fixtures for repository characterization tests.

Fixtures here build up a seeded MetadataRepository ready for port-level
assertions. FK prerequisites (organization, project, memory, dataset) are
added directly via db_session so the repository starts from a known state.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.metadata import (
    DatasetRecord,
    MetadataRepository,
    OrganizationRecord,
    ProjectMemoryRecord,
    ProjectRecord,
)
from tests.uuidv7_fixtures import DATASET_1, MEMORY_1, ORG_1, PROJECT_1


@pytest.fixture
async def repo(db_session: AsyncSession) -> MetadataRepository:
    """Bare MetadataRepository with no seeded rows."""
    return MetadataRepository(RestrictedSession(db_session))


@pytest.fixture
async def repo_with_project(db_session: AsyncSession) -> MetadataRepository:
    """MetadataRepository with ORG_1 + PROJECT_1 seeded (FK prerequisite)."""
    org = OrganizationRecord(id=ORG_1, name="Org 1")
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    db_session.add(org)
    db_session.add(project)
    await db_session.commit()
    return MetadataRepository(RestrictedSession(db_session))


@pytest.fixture
async def repo_with_memory(db_session: AsyncSession) -> MetadataRepository:
    """MetadataRepository with ORG_1 + PROJECT_1 + MEMORY_1 seeded."""
    org = OrganizationRecord(id=ORG_1, name="Org 1")
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    memory = ProjectMemoryRecord(
        id=MEMORY_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        stream_channel_id="ch-1",
    )
    db_session.add(org)
    db_session.add(project)
    db_session.add(memory)
    await db_session.commit()
    return MetadataRepository(RestrictedSession(db_session))


@pytest.fixture
async def repo_with_dataset(db_session: AsyncSession) -> MetadataRepository:
    """MetadataRepository with ORG_1 + PROJECT_1 + DATASET_1 seeded."""
    org = OrganizationRecord(id=ORG_1, name="Org 1")
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    dataset = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Test Dataset",
        schema_config={"fields": {}},
    )
    db_session.add(org)
    db_session.add(project)
    db_session.add(dataset)
    await db_session.commit()
    return MetadataRepository(RestrictedSession(db_session))
