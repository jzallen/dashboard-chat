"""Tests for DependencyService."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.metadata import (
    DatasetRecord,
    MetadataRepository,
    ProjectRecord,
    ViewRecord,
)
from app.use_cases.view.dependency_service import DependencyService
from app.use_cases.view.exceptions import CircularDependency, InvalidSourceReference
from tests.uuidv7_fixtures import DATASET_1, ORG_1, PROJECT_1, VIEW_1, VIEW_2, VIEW_3


@pytest.fixture
async def dep_service(db_session: AsyncSession):
    """Create a DependencyService with seeded data."""
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

    repo = MetadataRepository(RestrictedSession(db_session))
    return DependencyService(repo), repo, db_session


class TestValidateSourceRefs:
    """Tests for validate_source_refs."""

    async def test_valid_dataset_ref(self, dep_service):
        svc, _, _ = dep_service
        # Should not raise
        await svc.validate_source_refs([{"id": DATASET_1, "type": "dataset"}], PROJECT_1)

    async def test_valid_view_ref(self, dep_service):
        svc, _, db_session = dep_service
        view = ViewRecord(
            id=VIEW_1,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V1",
            sql_definition="SELECT 1",
        )
        db_session.add(view)
        await db_session.commit()

        await svc.validate_source_refs([{"id": VIEW_1, "type": "view"}], PROJECT_1)

    async def test_missing_ref_raises(self, dep_service):
        svc, _, _ = dep_service
        with pytest.raises(InvalidSourceReference) as exc_info:
            await svc.validate_source_refs([{"id": "nonexistent", "type": "dataset"}], PROJECT_1)
        assert "nonexistent" in str(exc_info.value)

    async def test_mixed_valid_and_missing(self, dep_service):
        svc, _, _ = dep_service
        with pytest.raises(InvalidSourceReference):
            await svc.validate_source_refs(
                [
                    {"id": DATASET_1, "type": "dataset"},
                    {"id": "missing-view", "type": "view"},
                ],
                PROJECT_1,
            )


class TestCheckCircularDependencies:
    """Tests for check_circular_dependencies."""

    async def test_no_cycle_with_datasets_only(self, dep_service):
        svc, _, _ = dep_service
        # Dataset refs never cause cycles
        await svc.check_circular_dependencies(VIEW_1, [{"id": DATASET_1, "type": "dataset"}])

    async def test_direct_self_cycle_raises(self, dep_service):
        svc, _, db_session = dep_service
        # Create VIEW_1 that references itself
        view = ViewRecord(
            id=VIEW_1,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V1",
            sql_definition="SELECT 1",
            source_refs=[],
        )
        db_session.add(view)
        await db_session.commit()

        with pytest.raises(CircularDependency):
            await svc.check_circular_dependencies(VIEW_1, [{"id": VIEW_1, "type": "view"}])

    async def test_transitive_cycle_raises(self, dep_service):
        svc, _, db_session = dep_service
        # VIEW_2 -> VIEW_3 -> VIEW_1 (and we're checking VIEW_1 -> VIEW_2)
        v2 = ViewRecord(
            id=VIEW_2,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V2",
            sql_definition="SELECT 1",
            source_refs=[{"id": VIEW_3, "type": "view"}],
        )
        v3 = ViewRecord(
            id=VIEW_3,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V3",
            sql_definition="SELECT 1",
            source_refs=[{"id": VIEW_1, "type": "view"}],
        )
        db_session.add(v2)
        db_session.add(v3)
        await db_session.commit()

        with pytest.raises(CircularDependency):
            await svc.check_circular_dependencies(VIEW_1, [{"id": VIEW_2, "type": "view"}])

    async def test_diamond_dependency_ok(self, dep_service):
        svc, _, db_session = dep_service
        # Diamond: VIEW_1 -> VIEW_2, VIEW_1 -> VIEW_3, VIEW_2 -> DATASET, VIEW_3 -> DATASET
        # No cycle, should be fine
        v2 = ViewRecord(
            id=VIEW_2,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V2",
            sql_definition="SELECT 1",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
        )
        v3 = ViewRecord(
            id=VIEW_3,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="V3",
            sql_definition="SELECT 1",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
        )
        db_session.add(v2)
        db_session.add(v3)
        await db_session.commit()

        # Should not raise
        await svc.check_circular_dependencies(
            VIEW_1,
            [{"id": VIEW_2, "type": "view"}, {"id": VIEW_3, "type": "view"}],
        )
