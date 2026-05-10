"""Shared fixtures for repository characterization tests.

Phase 00 of ADR-020 (metadata-repository split): the shared ``repo*``
fixtures construct a ``_LegacyMetadataFacade`` (the same class
``RepositoryContainer.metadata`` resolves to in production). The facade
delegates Project methods to the new :class:`ProjectRepository`, so
``test_project_repository.py`` characterizes the new class without any
test-body edits, while the seven not-yet-split aggregates' tests fall
through to the unsplit :class:`MetadataRepository` via ``__getattr__``.
Phase 01 of the roadmap replaces each fixture with a direct per-aggregate
constructor.
"""

import warnings

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.metadata import (
    DatasetRecord,
    OrganizationRecord,
    ProjectMemoryRecord,
    ProjectRecord,
)
from app.repositories.metadata._legacy_facade import _LegacyMetadataFacade
from tests.uuidv7_fixtures import DATASET_1, MEMORY_1, ORG_1, PROJECT_1


def _build_repo(db_session: AsyncSession) -> _LegacyMetadataFacade:
    """Construct the facade while suppressing its construction-time warning.

    The DeprecationWarning is part of the facade's contract (asserted in
    Phase 01's milestone-1 scenarios). Suppressing it inside the fixture
    keeps the repository characterization suites quiet without dampening
    the warning for production callers.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        return _LegacyMetadataFacade(RestrictedSession(db_session))


@pytest.fixture
async def repo(db_session: AsyncSession) -> _LegacyMetadataFacade:
    """Bare repository facade with no seeded rows."""
    return _build_repo(db_session)


@pytest.fixture
async def repo_with_project(db_session: AsyncSession) -> _LegacyMetadataFacade:
    """Repository facade with ORG_1 + PROJECT_1 seeded (FK prerequisite)."""
    org = OrganizationRecord(id=ORG_1, name="Org 1")
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    db_session.add(org)
    db_session.add(project)
    await db_session.commit()
    return _build_repo(db_session)


@pytest.fixture
async def repo_with_memory(db_session: AsyncSession) -> _LegacyMetadataFacade:
    """Repository facade with ORG_1 + PROJECT_1 + MEMORY_1 seeded."""
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
    return _build_repo(db_session)


@pytest.fixture
async def repo_with_dataset(db_session: AsyncSession) -> _LegacyMetadataFacade:
    """Repository facade with ORG_1 + PROJECT_1 + DATASET_1 seeded."""
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
    return _build_repo(db_session)
