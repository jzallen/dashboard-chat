"""Tests for Source operations on the metadata repository.

Covers: create_source / get_source / list_sources / link_dataset_to_source /
update_source_schema. Org scoping is transitive via project_id, so the FK
prerequisite is ORG_1 + PROJECT_1 (the shared ``repo_with_project`` fixture).
"""

from datetime import datetime

from app.repositories.metadata import DatasetRecord, ProjectRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    ORG_1,
    PROJECT_1,
    PROJECT_2,
    USER_1,
)


class TestCreateSource:
    async def test_returns_dict_with_generated_id_and_timestamps(self, repo_with_project):
        result = await repo_with_project.create_source(
            project_id=PROJECT_1,
            name="Patients",
            schema_config={"fields": {"patient_id": {"type": "text"}}},
            created_by=USER_1,
        )
        assert result["project_id"] == PROJECT_1
        assert result["name"] == "Patients"
        assert result["schema_config"] == {"fields": {"patient_id": {"type": "text"}}}
        assert result["created_by"] == USER_1
        assert result["id"] is not None
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_defaults_schema_config_to_empty_dict(self, repo_with_project):
        result = await repo_with_project.create_source(project_id=PROJECT_1, name="Empty")
        assert result["schema_config"] == {}
        assert result["created_by"] is None


class TestGetSource:
    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_source("019515a0-b0ff-7000-8000-0000000000ff") is None

    async def test_returns_created_source(self, repo_with_project):
        created = await repo_with_project.create_source(project_id=PROJECT_1, name="Patients")
        fetched = await repo_with_project.get_source(created["id"])
        assert fetched["id"] == created["id"]
        assert fetched["name"] == "Patients"


class TestListSources:
    async def test_returns_only_sources_for_the_project(self, repo_with_project, db_session):
        db_session.add(ProjectRecord(id=PROJECT_2, name="Other", org_id=ORG_1))
        await db_session.commit()

        await repo_with_project.create_source(project_id=PROJECT_1, name="A")
        await repo_with_project.create_source(project_id=PROJECT_1, name="B")
        await repo_with_project.create_source(project_id=PROJECT_2, name="Other-Source")

        sources = await repo_with_project.list_sources(PROJECT_1)
        names = {s["name"] for s in sources}
        assert names == {"A", "B"}

    async def test_returns_empty_list_when_no_sources(self, repo_with_project):
        assert await repo_with_project.list_sources(PROJECT_1) == []


class TestListSourcesColdStorageFilter:
    """Cold-Storage filter on list_sources (mirrors list_datasets, MR-7).

    ``archived=None``/``False`` returns only active rows (``archived_at IS NULL``) —
    the default catalog view; ``archived=True`` returns only archived rows
    (``archived_at IS NOT NULL``) — the Cold-Storage list.
    """

    async def _archive(self, repo, source_id):
        await repo.update_source(
            source_id,
            archived_at=datetime(2026, 7, 22, 12, 0, 0),
            retention_until=datetime(2026, 10, 20, 12, 0, 0),
        )

    async def test_default_excludes_archived_sources(self, repo_with_project):
        await repo_with_project.create_source(project_id=PROJECT_1, name="Active")
        archived = await repo_with_project.create_source(project_id=PROJECT_1, name="Archived")
        await self._archive(repo_with_project, archived["id"])

        sources = await repo_with_project.list_sources(PROJECT_1)

        assert {s["name"] for s in sources} == {"Active"}

    async def test_archived_false_excludes_archived_sources(self, repo_with_project):
        await repo_with_project.create_source(project_id=PROJECT_1, name="Active")
        archived = await repo_with_project.create_source(project_id=PROJECT_1, name="Archived")
        await self._archive(repo_with_project, archived["id"])

        sources = await repo_with_project.list_sources(PROJECT_1, archived=False)

        assert {s["name"] for s in sources} == {"Active"}

    async def test_archived_true_returns_only_archived_sources(self, repo_with_project):
        await repo_with_project.create_source(project_id=PROJECT_1, name="Active")
        archived = await repo_with_project.create_source(project_id=PROJECT_1, name="Archived")
        await self._archive(repo_with_project, archived["id"])

        sources = await repo_with_project.list_sources(PROJECT_1, archived=True)

        assert {s["name"] for s in sources} == {"Archived"}

    async def test_archived_true_returns_empty_when_none_archived(self, repo_with_project):
        await repo_with_project.create_source(project_id=PROJECT_1, name="Active")

        assert await repo_with_project.list_sources(PROJECT_1, archived=True) == []


class TestLinkDatasetToSource:
    async def test_sets_source_id_on_dataset(self, repo_with_project, db_session):
        db_session.add(DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="Staging", schema_config={"fields": {}}))
        await db_session.commit()
        source = await repo_with_project.create_source(project_id=PROJECT_1, name="Patients")

        await repo_with_project.link_dataset_to_source(dataset_id=DATASET_1, source_id=source["id"])

        record = await db_session.get(DatasetRecord, DATASET_1)
        await db_session.refresh(record)
        assert record.source_id == source["id"]


class TestUpdateSourceSchema:
    async def test_replaces_schema_config(self, repo_with_project):
        source = await repo_with_project.create_source(
            project_id=PROJECT_1, name="Patients", schema_config={"fields": {"a": {"type": "text"}}}
        )
        new_schema = {"fields": {"a": {"type": "text"}, "b": {"type": "number"}}}

        await repo_with_project.update_source_schema(source_id=source["id"], schema_config=new_schema)

        fetched = await repo_with_project.get_source(source["id"])
        assert fetched["schema_config"] == new_schema
