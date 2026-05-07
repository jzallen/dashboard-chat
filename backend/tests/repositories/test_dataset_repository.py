"""Characterization tests for Dataset operations on MetadataRepository.

Covers:
- create_dataset / get_dataset / get_dataset_record / update_dataset / delete_dataset
- dataset_exists
- list_datasets (filter by project, transforms include/exclude deleted)
- search_datasets_by_name (ilike, name-asc ordering, limit 10)
"""

from app.repositories.metadata import DatasetRecord, ProjectRecord, TransformRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_2,
    DATASET_3,
    DATASET_OTHER,
    ORG_1,
    PROJECT_1,
    PROJECT_2,
    TRANSFORM_1,
    TRANSFORM_2,
)


class TestCreateDataset:
    async def test_returns_dict_with_generated_id_and_storage_path(self, repo_with_project):
        result = await repo_with_project.create_dataset(
            project_id=PROJECT_1,
            name="Sales",
            schema_config={"fields": {"amount": {"type": "number"}}},
            description="Monthly sales",
        )
        assert result["project_id"] == PROJECT_1
        assert result["name"] == "Sales"
        assert result["description"] == "Monthly sales"
        assert result["schema_config"] == {"fields": {"amount": {"type": "number"}}}
        assert result["partition_fields"] == []  # default for None input
        assert result["column_profiles"] is None
        assert result["format_context"] is None
        assert result["row_count"] is None
        assert result["id"] is not None
        # storage_path is a computed column: 'datasets/{project_id}/{id}/'
        assert result["storage_path"] == f"datasets/{PROJECT_1}/{result['id']}/"
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_accepts_partition_fields_and_column_profiles(self, repo_with_project):
        result = await repo_with_project.create_dataset(
            project_id=PROJECT_1,
            name="Partitioned",
            schema_config={"fields": {}},
            partition_fields=["year", "month"],
            column_profiles={"amount": {"type": "number", "unique_count": 50}},
            format_context="HL7v2",
        )
        assert result["partition_fields"] == ["year", "month"]
        assert result["column_profiles"] == {"amount": {"type": "number", "unique_count": 50}}
        assert result["format_context"] == "HL7v2"

    async def test_persists_row_count_when_provided(self, repo_with_project):
        result = await repo_with_project.create_dataset(
            project_id=PROJECT_1,
            name="Counted",
            schema_config={"fields": {}},
            row_count=250,
        )
        assert result["row_count"] == 250


class TestGetDataset:
    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_dataset("nonexistent-id") is None

    async def test_returns_dict_with_transforms_by_default(self, repo_with_dataset, db_session):
        t = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="T1",
            condition_json={"rule": "x"},
            condition_sql="x = 1",
        )
        db_session.add(t)
        await db_session.commit()

        result = await repo_with_dataset.get_dataset(DATASET_1)
        assert result is not None
        assert result["id"] == DATASET_1
        assert "transforms" in result
        assert len(result["transforms"]) == 1
        assert result["transforms"][0]["id"] == TRANSFORM_1

    async def test_excludes_deleted_transforms_when_transforms_included(self, repo_with_dataset, db_session):
        active = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="Active",
            condition_json={},
            condition_sql="",
            status="enabled",
        )
        deleted = TransformRecord(
            id=TRANSFORM_2,
            dataset_id=DATASET_1,
            name="Deleted",
            condition_json={},
            condition_sql="",
            status="deleted",
        )
        db_session.add(active)
        db_session.add(deleted)
        await db_session.commit()

        result = await repo_with_dataset.get_dataset(DATASET_1, include_transforms=True)
        transform_ids = {t["id"] for t in result["transforms"]}
        assert transform_ids == {TRANSFORM_1}  # deleted filtered out

    async def test_omits_transforms_key_when_include_transforms_false(self, repo_with_dataset):
        result = await repo_with_dataset.get_dataset(DATASET_1, include_transforms=False)
        assert result is not None
        assert "transforms" not in result


class TestGetDatasetRecord:
    async def test_returns_orm_record_with_project_loaded(self, repo_with_dataset):
        record = await repo_with_dataset.get_dataset_record(DATASET_1)
        assert record is not None
        assert isinstance(record, DatasetRecord)
        assert record.id == DATASET_1
        # project relationship is eager-loaded via joinedload
        assert record.project is not None
        assert record.project.id == PROJECT_1

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.get_dataset_record("nonexistent-id") is None


class TestUpdateDataset:
    async def test_applies_kwargs_and_returns_record(self, repo_with_dataset):
        record = await repo_with_dataset.update_dataset(DATASET_1, name="Renamed", description="New desc")
        assert record is not None
        assert isinstance(record, DatasetRecord)
        assert record.name == "Renamed"
        assert record.description == "New desc"

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.update_dataset("nonexistent-id", name="X") is None


class TestDeleteDataset:
    async def test_returns_storage_path_and_removes_dataset(self, repo_with_dataset):
        storage_path = await repo_with_dataset.delete_dataset(DATASET_1)
        assert storage_path == f"datasets/{PROJECT_1}/{DATASET_1}/"
        assert await repo_with_dataset.get_dataset(DATASET_1) is None

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.delete_dataset("nonexistent-id") is None


class TestDatasetExists:
    async def test_returns_true_when_exists(self, repo_with_dataset):
        assert await repo_with_dataset.dataset_exists(DATASET_1) is True

    async def test_returns_false_when_missing(self, repo):
        assert await repo.dataset_exists("nonexistent-id") is False


class TestListDatasets:
    async def test_returns_empty_when_no_datasets(self, repo_with_project):
        records, cursor, has_more = await repo_with_project.list_datasets(project_id=PROJECT_1)
        assert records == []
        assert cursor is None
        assert has_more is False

    async def test_filters_by_project_id(self, repo, db_session):
        # Two projects, one dataset each
        p1 = ProjectRecord(id=PROJECT_1, name="P1", org_id=ORG_1)
        p2 = ProjectRecord(id=PROJECT_2, name="P2", org_id=ORG_1)
        d1 = DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="Mine", schema_config={"fields": {}})
        d_other = DatasetRecord(id=DATASET_OTHER, project_id=PROJECT_2, name="Theirs", schema_config={"fields": {}})
        db_session.add(p1)
        db_session.add(p2)
        db_session.add(d1)
        db_session.add(d_other)
        await db_session.commit()

        records, _, _ = await repo.list_datasets(project_id=PROJECT_1)
        ids = {r.id for r in records}
        assert ids == {DATASET_1}

    async def test_returns_orm_records_with_transforms_eager_loaded(self, repo_with_dataset, db_session):
        active = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="Active",
            condition_json={},
            condition_sql="",
            status="enabled",
        )
        deleted = TransformRecord(
            id=TRANSFORM_2,
            dataset_id=DATASET_1,
            name="Gone",
            condition_json={},
            condition_sql="",
            status="deleted",
        )
        db_session.add(active)
        db_session.add(deleted)
        await db_session.commit()

        records, _, _ = await repo_with_dataset.list_datasets(project_id=PROJECT_1, include_transforms=True)
        assert len(records) == 1
        transform_ids = {t.id for t in records[0].transforms}
        assert transform_ids == {TRANSFORM_1}  # deleted filtered

    async def test_unpaginated_when_limit_none(self, repo_with_project, db_session):
        d1 = DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="A", schema_config={"fields": {}})
        d2 = DatasetRecord(id=DATASET_2, project_id=PROJECT_1, name="B", schema_config={"fields": {}})
        db_session.add(d1)
        db_session.add(d2)
        await db_session.commit()

        records, cursor, has_more = await repo_with_project.list_datasets(project_id=PROJECT_1, limit=None)
        assert len(records) == 2
        assert cursor is None
        assert has_more is False

    async def test_cursor_pagination_has_more_and_next_cursor(self, repo_with_project, db_session):
        d1 = DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="A", schema_config={"fields": {}})
        d2 = DatasetRecord(id=DATASET_2, project_id=PROJECT_1, name="B", schema_config={"fields": {}})
        d3 = DatasetRecord(id=DATASET_3, project_id=PROJECT_1, name="C", schema_config={"fields": {}})
        db_session.add(d1)
        db_session.add(d2)
        db_session.add(d3)
        await db_session.commit()

        # Page 1: id-desc order, limit=2 => [D3, D2]
        records_p1, cursor_p1, has_more_p1 = await repo_with_project.list_datasets(
            project_id=PROJECT_1, include_transforms=False, limit=2
        )
        assert [r.id for r in records_p1] == [DATASET_3, DATASET_2]
        assert has_more_p1 is True
        assert cursor_p1 is not None

        # Page 2: [D1], no more
        records_p2, cursor_p2, has_more_p2 = await repo_with_project.list_datasets(
            project_id=PROJECT_1, include_transforms=False, cursor=cursor_p1, limit=2
        )
        assert [r.id for r in records_p2] == [DATASET_1]
        assert has_more_p2 is False
        assert cursor_p2 is None


class TestSearchDatasetsByName:
    async def test_ilike_match_is_case_insensitive(self, repo_with_project, db_session):
        d1 = DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="Sales Report", schema_config={"fields": {}})
        d2 = DatasetRecord(id=DATASET_2, project_id=PROJECT_1, name="Users", schema_config={"fields": {}})
        db_session.add(d1)
        db_session.add(d2)
        await db_session.commit()

        results = await repo_with_project.search_datasets_by_name(PROJECT_1, "SALES")
        ids = {r["id"] for r in results}
        assert ids == {DATASET_1}

    async def test_orders_by_name_ascending(self, repo_with_project, db_session):
        # All names share the substring "data" — order must be asc by name
        d1 = DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="Zebra-data", schema_config={"fields": {}})
        d2 = DatasetRecord(id=DATASET_2, project_id=PROJECT_1, name="Alpha-data", schema_config={"fields": {}})
        d3 = DatasetRecord(id=DATASET_3, project_id=PROJECT_1, name="Mid-data", schema_config={"fields": {}})
        db_session.add(d1)
        db_session.add(d2)
        db_session.add(d3)
        await db_session.commit()

        results = await repo_with_project.search_datasets_by_name(PROJECT_1, "data")
        names = [r["name"] for r in results]
        assert names == ["Alpha-data", "Mid-data", "Zebra-data"]

    async def test_returns_empty_when_no_match(self, repo_with_project):
        assert await repo_with_project.search_datasets_by_name(PROJECT_1, "nomatch") == []
