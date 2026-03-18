from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories import set_session
from app.types import QueryBuilderJSON
from app.use_cases.dataset import get_dataset
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1, TRANSFORM_1


class TestGetDataset:
    """Tests for get_dataset workflow."""

    async def test_get_dataset_when_valid_id_returns_dataset_with_transforms(self, seeded_db: AsyncSession):
        """get_dataset should return Dataset with transforms by default."""
        set_session(seeded_db)

        result = await get_dataset(dataset_id=DATASET_1)

        match result:
            case Success(dataset):
                expected = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Dataset One",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[
                        Transform(
                            id=TRANSFORM_1,
                            name="Filter Active",
                            condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                            condition_sql="col1 = 'active'",
                            description="Filter for active records",
                            status="enabled",
                            transform_type="filter",
                            created_at=dataset.transforms[0].created_at,
                        )
                    ],
                )
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should return dataset for valid id, got: {error}")

    async def test_get_dataset_when_include_transforms_false_returns_empty_transforms(self, seeded_db: AsyncSession):
        """get_dataset with include_transforms=False should return empty transforms list."""
        set_session(seeded_db)

        result = await get_dataset(
            dataset_id=DATASET_1,
            include_transforms=False,
        )

        match result:
            case Success(dataset):
                assert dataset.transforms == []
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

    async def test_get_dataset_when_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """get_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await get_dataset(dataset_id="nonexistent")

        match result:
            case Failure(error):
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("get_dataset should fail when dataset does not exist")

    async def test_get_dataset_when_include_preview_true_returns_preview_rows(self, seeded_db: AsyncSession):
        """get_dataset with include_preview should populate preview_rows."""
        set_session(seeded_db)

        mock_preview = [{"col1": "value1"}, {"col1": "value2"}]

        with patch.object(Dataset, "query_preview_rows", return_value=mock_preview):
            result = await get_dataset(
                dataset_id=DATASET_1,
                include_preview=True,
                preview_limit=5,
            )

        match result:
            case Success(dataset):
                assert isinstance(dataset, Dataset)
                assert dataset.preview_rows == mock_preview
            case Failure(error):
                pytest.fail(f"get_dataset with preview should succeed, got: {error}")

    async def test_get_dataset_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """get_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def get_dataset_record(self, dataset_id: str, include_transforms: bool = True):
                raise SQLAlchemyError("Connection lost")

        result = await get_dataset(
            dataset_id=DATASET_1,
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Connection lost"
            case Success(_):
                pytest.fail("get_dataset should fail when database error occurs")

    async def test_get_dataset_when_lake_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """get_dataset should return Failure when preview query fails."""
        set_session(seeded_db)

        def failing_preview(limit=10):
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "Key not found"}}, "GetObject")

        with patch.object(Dataset, "query_preview_rows", side_effect=failing_preview):
            result = await get_dataset(
                dataset_id=DATASET_1,
                include_preview=True,
            )

        match result:
            case Failure(error):
                assert "Key not found" in str(error)
            case Success(_):
                pytest.fail("get_dataset should fail when lake error occurs")
