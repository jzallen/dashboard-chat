
import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError
from botocore.exceptions import ClientError


from app.use_cases.dataset import get_dataset
from app.repositories import set_session
from app.models.dataset import Dataset



class TestGetDataset:
    """Tests for get_dataset workflow."""

    async def test_given_valid_id_returns_dataset_with_transforms(self, seeded_db: AsyncSession):
        """get_dataset should return Dataset with transforms by default."""
        set_session(seeded_db)

        result = await get_dataset(dataset_id="dataset-001")

        match result:
            case Success(dataset):
                assert dataset.id == "dataset-001"
                assert dataset.project_id == "project-001"
                assert dataset.name == "Dataset One"
                assert dataset.schema_config == {"fields": {"col1": {"type": "text"}}}
                assert len(dataset.transforms) == 1
                t = dataset.transforms[0]
                assert t.id == "transform-001"
                assert t.name == "Filter Active"
                assert t.condition_sql == "col1 = 'active'"
                assert t.status == 'enabled'
                assert t.transform_type == 'filter'
            case Failure(error):
                pytest.fail(f"get_dataset should return dataset for valid id, got: {error}")

    async def test_with_include_transforms_false_returns_empty_transforms(self, seeded_db: AsyncSession):
        """get_dataset with include_transforms=False should return empty transforms list."""
        set_session(seeded_db)

        result = await get_dataset(
            dataset_id="dataset-001",
            include_transforms=False,
        )

        match result:
            case Success(dataset):
                assert dataset.transforms == []
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """get_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await get_dataset(dataset_id="nonexistent")

        match result:
            case Failure(error):
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("get_dataset should fail when dataset does not exist")

    async def test_with_include_preview_returns_preview_rows(self, seeded_db: AsyncSession):
        """get_dataset with include_preview should populate preview_rows."""
        set_session(seeded_db)

        mock_preview = [{"col1": "value1"}, {"col1": "value2"}]

        class MockLakeRepository:
            def read_parquet_preview(self, storage_path: str, limit: int = 10):
                return mock_preview

        result = await get_dataset(
            dataset_id="dataset-001",
            include_preview=True,
            preview_limit=5,
            repositories={'lake_repository': MockLakeRepository},
        )

        match result:
            case Success(dataset):
                assert isinstance(dataset, Dataset)
                assert dataset.preview_rows == mock_preview
            case Failure(error):
                pytest.fail(f"get_dataset with preview should succeed, got: {error}")

    async def test_when_database_error_returns_metadata_repository_error(self, seeded_db: AsyncSession):
        """get_dataset should return MetadataRepositoryError when database fails."""
        set_session(seeded_db)


        class FailingMetadataRepository:
            async def get_dataset_record(self, dataset_id: str, include_transforms: bool = True):
                raise SQLAlchemyError("Connection lost")

        result = await get_dataset(
            dataset_id="dataset-001",
            repositories={'metadata_repository': FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Connection lost"
            case Success(_):
                pytest.fail("get_dataset should fail when database error occurs")

    async def test_when_lake_error_returns_lake_repository_error(self, seeded_db: AsyncSession):
        """get_dataset should return LakeRepositoryError when storage fails."""
        set_session(seeded_db)

        class FailingLakeRepository:
            def read_parquet_preview(self, storage_path: str, limit: int = 10):
                raise ClientError(
                    {"Error": {"Code": "NoSuchKey", "Message": "Key not found"}},
                    "GetObject"
                )

        result = await get_dataset(
            dataset_id="dataset-001",
            include_preview=True,
            repositories={'lake_repository': FailingLakeRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "An error occurred (NoSuchKey) when calling the GetObject operation: Key not found"
            case Success(_):
                pytest.fail("get_dataset should fail when lake error occurs")
