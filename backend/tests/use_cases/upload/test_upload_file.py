
from functools import partial

import boto3
import pytest
from botocore.stub import Stubber
from returns.result import Success, Failure
from sqlalchemy.ext.asyncio import AsyncSession

from app.use_cases.upload import upload_file
from app.use_cases.exceptions import (
    DatasetNotFound, EmptyFile, InvalidFileType, ProjectNotFound,
)
from app.repositories import set_session
from app.repositories.lake import MinIOLakeRepository
from app.models import Upload


@pytest.fixture
def sample_csv() -> bytes:
    """Sample CSV content for testing."""
    return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"


@pytest.fixture
def s3_write_stubber() -> Stubber:
    """Stubber for S3 write operations used by upload_file."""
    stubber = Stubber(boto3.client("s3"))
    stubber.add_response('put_object', {})
    return stubber


class TestUploadFile:
    """Tests for upload_file use case."""

    async def test_upload_file_creates_upload(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes
    ):
        """upload_file should create an Upload with preview_rows."""
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id="project-001",
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"upload_file should succeed, got: {error}")
            case Success(upload):
                assert isinstance(upload, Upload)
                assert upload.project_id == "project-001"
                assert upload.dataset_id is None
                assert upload.original_filename == "test_data.csv"
                assert upload.file_size == len(sample_csv)
                assert len(upload.preview_rows) == 3
                assert upload.preview_rows[0] == {"name": "Alice", "age": 30, "active": True}

    async def test_upload_file_with_dataset_id(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes
    ):
        """upload_file should set dataset_id when provided."""
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id="project-001",
                dataset_id="dataset-001",
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        assert isinstance(result, Success)
        assert result.unwrap().dataset_id == "dataset-001"

    async def test_upload_file_rejects_non_csv(self, seeded_db: AsyncSession, sample_csv: bytes):
        """upload_file should return Failure for non-CSV files."""
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.xlsx",
            project_id="project-001",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), InvalidFileType)

    async def test_upload_file_rejects_empty_file(self, seeded_db: AsyncSession):
        """upload_file should return Failure for empty files."""
        set_session(seeded_db)

        result = await upload_file(
            file_content=b"",
            file_name="empty.csv",
            project_id="project-001",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EmptyFile)

    async def test_upload_file_rejects_nonexistent_project(
        self, seeded_db: AsyncSession, sample_csv: bytes
    ):
        """upload_file should return Failure for nonexistent project."""
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="nonexistent-project",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_upload_file_rejects_nonexistent_dataset(
        self, seeded_db: AsyncSession, sample_csv: bytes
    ):
        """upload_file should return Failure for nonexistent dataset."""
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="project-001",
            dataset_id="nonexistent-dataset",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), DatasetNotFound)
