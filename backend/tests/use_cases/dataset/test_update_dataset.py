
import pytest
from dataclasses import asdict, replace
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError


from app.use_cases.dataset import update_dataset, get_dataset
from app.repositories import set_session
from app.models.dataset import Dataset
from app.models.transform import Transform
from app.types import QueryBuilderJSON



class TestUpdateDataset:
    """Tests for DatasetController.update_dataset workflow."""

    async def test_partial_update_changes_only_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with partial data should only change specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id="dataset-001",
            update_dict={"name": "Updated Dataset Name"},
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            name="Updated Dataset Name",
            description=None,
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    status='enabled',
                ),
            ],
        )

        match result:
            case Success(dataset):
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_full_update_changes_all_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with multiple fields should update all specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id="dataset-001",
            update_dict={"name": "Fully Updated Dataset", "description": "New description"},
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            name="Fully Updated Dataset",
            description="New description",
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    status='enabled',
                ),
            ],
        )

        match result:
            case Success(dataset):
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id="nonexistent",
            update_dict={"name": "New Name"},
        )

        match result:
            case Failure(error):
                assert error == "[update_dataset] Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("update_dataset should fail when dataset does not exist")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def dataset_exists(self, dataset_id: str) -> bool:
                raise SQLAlchemyError("Database connection lost")

        result = await update_dataset(
            dataset_id="dataset-001",
            update_dict={"name": "New Name"},
            repositories={'metadata_repository': FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert error == "[update_dataset] Database connection lost"
            case Success(_):
                pytest.fail("update_dataset should fail when database error occurs")

    async def test_transform_marked_for_deletion_is_removed(self, seeded_db: AsyncSession):
        """update_dataset should delete transforms with status='deleted'."""
        set_session(seeded_db)

        # Get initial state - transform should exist with status='enabled'
        initial_result = await get_dataset(dataset_id="dataset-001")
        match initial_result:
            case Success(initial_dataset):
                assert len(initial_dataset.transforms) == 1
                assert initial_dataset.transforms[0].status == 'enabled'
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

        # Update with transform marked for deletion
        update_result = await update_dataset(
            dataset_id="dataset-001",
            update_dict={
                "transforms": [
                    {"id": "transform-001", "name": "Filter Active", "status": "deleted"},
                ],
            },
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            name="Dataset One",
            description=None,
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[],
        )

        match update_result:
            case Success(updated_dataset):
                assert updated_dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

        # Get again and verify matches update result
        final_result = await get_dataset(dataset_id="dataset-001")
        match final_result:
            case Success(final_dataset):
                assert final_dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

    async def test_transform_status_updated_to_disabled(self, seeded_db: AsyncSession):
        """update_dataset should update transform status to disabled."""
        set_session(seeded_db)

        # Get initial state - transform should be enabled
        initial_result = await get_dataset(dataset_id="dataset-001")
        match initial_result:
            case Success(initial_dataset):
                assert len(initial_dataset.transforms) == 1
                assert initial_dataset.transforms[0].status == 'enabled'
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

        # Build expected state with transform status changed to disabled
        expected = replace(initial_dataset, transforms=[
            replace(initial_dataset.transforms[0], status='disabled')
        ])

        # Serialize and call update_dataset
        updated = asdict(expected)
        dataset_id = updated.pop('id')
        update_result = await update_dataset(
            dataset_id=dataset_id,
            update_dict=updated,
        )

        match update_result:
            case Success(updated_dataset):
                assert updated_dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

        # Get again and verify matches update result
        final_result = await get_dataset(dataset_id=dataset_id)
        match final_result:
            case Success(final_dataset):
                assert final_dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")
