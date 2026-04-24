"""Characterization tests for Transform operations on MetadataRepository.

Covers the 5 methods in scope:
- create_transform
- create_transforms_batch
- update_transform (partial update semantics; version increment on condition_json)
- update_transforms (bulk update)
- delete_transform
"""

from sqlalchemy import select

from app.repositories.metadata import TransformRecord
from tests.uuidv7_fixtures import (
    DATASET_1,
    TRANSFORM_1,
    TRANSFORM_2,
    TRANSFORM_3,
)


class TestCreateTransform:
    async def test_returns_dict_with_defaults(self, repo_with_dataset):
        result = await repo_with_dataset.create_transform(
            dataset_id=DATASET_1,
            name="Filter A",
            condition_json={"rule": "x"},
            condition_sql="x = 1",
            description="A filter",
            nl_prompt="show x=1",
        )
        assert result["dataset_id"] == DATASET_1
        assert result["name"] == "Filter A"
        assert result["description"] == "A filter"
        assert result["condition_json"] == {"rule": "x"}
        assert result["condition_sql"] == "x = 1"
        assert result["nl_prompt"] == "show x=1"
        # version/status/transform_type use the ORM defaults
        assert result["version"] == 1
        assert result["status"] == "enabled"
        assert result["transform_type"] == "filter"
        assert result["id"] is not None
        assert result["created_at"] is not None

    async def test_rejects_invalid_condition_sql(self, repo_with_dataset):
        # DELETE statement is forbidden by validate_condition_sql
        import pytest

        with pytest.raises(ValueError):
            await repo_with_dataset.create_transform(
                dataset_id=DATASET_1,
                name="Bad",
                condition_json={},
                condition_sql="DELETE FROM t",
            )

    async def test_allows_empty_condition_sql_without_validation(self, repo_with_dataset):
        # Empty condition_sql bypasses validate_condition_sql (falsy guard)
        result = await repo_with_dataset.create_transform(
            dataset_id=DATASET_1,
            name="NoSql",
            condition_json={"rule": "y"},
            condition_sql="",
        )
        assert result["condition_sql"] == ""


class TestCreateTransformsBatch:
    async def test_returns_list_with_generated_ids(self, repo_with_dataset):
        batch = [
            {
                "name": "T1",
                "condition_json": {"rule": "x"},
                "condition_sql": "x = 1",
            },
            {
                "name": "T2",
                "condition_json": {"rule": "y"},
                "condition_sql": "y = 2",
                "description": "desc2",
                "transform_type": "value_map",
                "target_column": "y",
                "expression_sql": "y + 1",
                "expression_config": {"method": "add"},
            },
        ]
        results = await repo_with_dataset.create_transforms_batch(
            dataset_id=DATASET_1, transforms_input=batch
        )
        assert len(results) == 2
        assert {r["name"] for r in results} == {"T1", "T2"}
        for r in results:
            assert r["id"] is not None
            assert r["dataset_id"] == DATASET_1
        # second record preserves optional fields
        t2 = next(r for r in results if r["name"] == "T2")
        assert t2["description"] == "desc2"
        assert t2["transform_type"] == "value_map"
        assert t2["target_column"] == "y"
        assert t2["expression_sql"] == "y + 1"
        assert t2["expression_config"] == {"method": "add"}

    async def test_returns_empty_list_when_input_empty(self, repo_with_dataset):
        results = await repo_with_dataset.create_transforms_batch(
            dataset_id=DATASET_1, transforms_input=[]
        )
        assert results == []


class TestUpdateTransform:
    async def test_updates_name_description_status_without_version_bump(
        self, repo_with_dataset, db_session
    ):
        t = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="Old",
            condition_json={"rule": "old"},
            condition_sql="old = 1",
            version=3,
            status="enabled",
        )
        db_session.add(t)
        await db_session.commit()

        result = await repo_with_dataset.update_transform(
            TRANSFORM_1,
            {"name": "New", "description": "updated", "status": "disabled"},
        )
        assert result is not None
        assert result["name"] == "New"
        assert result["description"] == "updated"
        assert result["status"] == "disabled"
        assert result["version"] == 3  # unchanged — no condition_json update

    async def test_increments_version_when_condition_json_updated(
        self, repo_with_dataset, db_session
    ):
        t = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="T",
            condition_json={"rule": "v1"},
            condition_sql="v = 1",
            version=1,
        )
        db_session.add(t)
        await db_session.commit()

        result = await repo_with_dataset.update_transform(
            TRANSFORM_1,
            {"condition_json": {"rule": "v2"}, "condition_sql": "v = 2"},
        )
        assert result is not None
        assert result["condition_json"] == {"rule": "v2"}
        assert result["condition_sql"] == "v = 2"
        assert result["version"] == 2

    async def test_returns_none_when_not_found(self, repo):
        assert await repo.update_transform("nonexistent-id", {"name": "X"}) is None


class TestUpdateTransforms:
    async def test_bulk_update_applies_changes(self, repo_with_dataset, db_session):
        t1 = TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="T1",
            condition_json={},
            condition_sql="",
            status="enabled",
        )
        t2 = TransformRecord(
            id=TRANSFORM_2,
            dataset_id=DATASET_1,
            name="T2",
            condition_json={},
            condition_sql="",
            status="enabled",
        )
        db_session.add(t1)
        db_session.add(t2)
        await db_session.commit()

        result = await repo_with_dataset.update_transforms(
            [
                {"id": TRANSFORM_1, "status": "disabled"},
                {"id": TRANSFORM_2, "status": "deleted"},
            ]
        )
        # update_transforms returns None — effect is observable via re-read.
        assert result is None

        stmt = select(TransformRecord).where(TransformRecord.id.in_([TRANSFORM_1, TRANSFORM_2]))
        rows = {r.id: r.status for r in (await db_session.execute(stmt)).scalars().all()}
        assert rows == {TRANSFORM_1: "disabled", TRANSFORM_2: "deleted"}

    async def test_noop_when_empty_updates_list(self, repo_with_dataset):
        # Empty list must not raise and must not touch anything.
        result = await repo_with_dataset.update_transforms([])
        assert result is None


class TestDeleteTransform:
    async def test_returns_true_and_removes_transform(self, repo_with_dataset, db_session):
        t = TransformRecord(
            id=TRANSFORM_3,
            dataset_id=DATASET_1,
            name="Doomed",
            condition_json={},
            condition_sql="",
        )
        db_session.add(t)
        await db_session.commit()

        assert await repo_with_dataset.delete_transform(TRANSFORM_3) is True

        stmt = select(TransformRecord).where(TransformRecord.id == TRANSFORM_3)
        assert (await db_session.execute(stmt)).scalar_one_or_none() is None

    async def test_returns_false_when_not_found(self, repo):
        assert await repo.delete_transform("nonexistent-id") is False
