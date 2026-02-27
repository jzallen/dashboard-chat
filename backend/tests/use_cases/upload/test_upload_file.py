from functools import partial

import boto3
import pytest
from botocore.stub import Stubber
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Upload
from app.repositories import set_session
from app.repositories.lake import MinIOLakeRepository
from app.use_cases.exceptions import (
    DatasetNotFound,
    EmptyFile,
    InvalidFileType,
    ProjectNotFound,
)
from app.use_cases.upload import upload_file
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1


@pytest.fixture
def sample_csv() -> bytes:
    return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"


@pytest.fixture
def s3_write_stubber() -> Stubber:
    stubber = Stubber(boto3.client("s3"))
    stubber.add_response("put_object", {})
    return stubber


class TestUploadFile:
    """Tests for upload_file use case."""

    async def test_upload_when_valid_csv_creates_upload_with_preview(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes
    ):
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id=PROJECT_1,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
            case Success(upload):
                assert isinstance(upload, Upload)
                assert upload.project_id == PROJECT_1
                assert upload.dataset_id is None
                assert upload.original_filename == "test_data.csv"
                assert upload.file_size == len(sample_csv)
                assert len(upload.preview_rows) == 3
                assert upload.preview_rows[0] == {"name": "Alice", "age": 30, "active": True}

    async def test_upload_when_dataset_id_provided_associates_dataset(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes
    ):
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id=PROJECT_1,
                dataset_id=DATASET_1,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        assert isinstance(result, Success)
        assert result.unwrap().dataset_id == DATASET_1

    async def test_upload_when_non_csv_file_raises_invalid_file_type(
        self, seeded_db: AsyncSession, sample_csv: bytes
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.xlsx",
            project_id=PROJECT_1,
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), InvalidFileType)

    async def test_upload_when_empty_file_raises_empty_file(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await upload_file(
            file_content=b"",
            file_name="empty.csv",
            project_id=PROJECT_1,
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EmptyFile)

    async def test_upload_when_project_missing_raises_project_not_found(
        self, seeded_db: AsyncSession, sample_csv: bytes
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="nonexistent-project",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_upload_when_dataset_missing_raises_dataset_not_found(
        self, seeded_db: AsyncSession, sample_csv: bytes
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id=PROJECT_1,
            dataset_id="nonexistent-dataset",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), DatasetNotFound)
