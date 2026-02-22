
import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.use_cases.dataset import update_dataset
from app.repositories import set_session
from app.models.dataset import Dataset
from app.models.transform import Transform
from app.types import QueryBuilderJSON
from tests.uuidv7_fixtures import PROJECT_1, DATASET_1, TRANSFORM_1



class TestUpdateDataset:
    """Tests for DatasetController.update_dataset workflow."""

    async def test_partial_update_changes_only_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with partial data should only change specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "Updated Dataset Name"},
        )

        match result:
            case Success(dataset):
                expected = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Updated Dataset Name",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[Transform(
                        id=TRANSFORM_1,
                        name="Filter Active",
                        condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                        condition_sql="col1 = 'active'",
                        description="Filter for active records",
                        status='enabled',
                        transform_type='filter',
                        created_at=dataset.transforms[0].created_at,
                    )],
                )
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_full_update_changes_all_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with multiple fields should update all specified fields."""
        set_session(seeded_db)

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "Fully Updated Dataset", "description": "New description"},
        )

        match result:
            case Success(dataset):
                expected = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Fully Updated Dataset",
                    description="New description",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[Transform(
                        id=TRANSFORM_1,
                        name="Filter Active",
                        condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                        condition_sql="col1 = 'active'",
                        description="Filter for active records",
                        status='enabled',
                        transform_type='filter',
                        created_at=dataset.transforms[0].created_at,
                    )],
                )
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
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("update_dataset should fail when dataset does not exist")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def dataset_exists(self, dataset_id: str) -> bool:
                raise SQLAlchemyError("Database connection lost")

        result = await update_dataset(
            dataset_id=DATASET_1,
            update_dict={"name": "New Name"},
            repositories={'metadata_repository': FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Database connection lost"
            case Success(_):
                pytest.fail("update_dataset should fail when database error occurs")

    # Transform CUD tests moved to tests/use_cases/transform/
