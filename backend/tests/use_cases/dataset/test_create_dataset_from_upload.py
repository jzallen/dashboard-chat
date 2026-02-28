import io
from dataclasses import asdict
from functools import partial

import boto3
import pytest
from botocore.stub import Stubber
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.repositories import set_session
from app.repositories.lake import MinIOLakeRepository
from app.repositories.outbox import OutboxRecord
from app.repositories.outbox.events import UploadFileReceived
from app.use_cases.dataset import create_dataset_from_upload
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.upload.exceptions import UploadNotFound
from tests.uuidv7_fixtures import PROJECT_1


@pytest.fixture
def sample_csv() -> bytes:
    """Sample CSV content for testing."""
    return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"


@pytest.fixture
def s3_read_write_stubber(sample_csv: bytes) -> Stubber:
    """Stubber for S3 read/write operations used by create-from-upload flow."""
    stubber = Stubber(boto3.client("s3"))
    stubber.add_response(
        "get_object",
        {
            "Body": io.BytesIO(sample_csv),
        },
        {
            "Bucket": "dashboard-chat.datalake",
            "Key": f"uploads/{PROJECT_1}/test_data.csv",
        },
    )
    # One put_object per partition value (age: 25, 30, 35)
    for _ in range(3):
        stubber.add_response("put_object", {})
    return stubber


class TestCreateDatasetFromUpload:
    """Tests for create_dataset_from_upload use case."""

    async def test_create_dataset_when_upload_is_valid_returns_dataset(
        self, seeded_db: AsyncSession, s3_read_write_stubber: Stubber, sample_csv: bytes
    ):
        """create_dataset_from_upload should return a Dataset with correct schema and preview rows."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-001",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/test_data.csv",
                        original_filename="test_data.csv",
                        file_size=len(sample_csv),
                    )
                ),
            )
        )
        await seeded_db.commit()

        with s3_read_write_stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-001",
                partition_fields=["age"],
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_read_write_stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"create_dataset_from_upload should succeed, got: {error}")
            case Success(dataset):
                expected = Dataset(
                    id=dataset.id,  # dynamic UUID
                    project_id=PROJECT_1,
                    name="New Dataset",
                    description=None,
                    schema_config=dataset.schema_config,  # field types inferred at runtime
                    partition_fields=["age"],
                    transforms=[],
                    preview_rows=dataset.preview_rows,  # dynamic computed data
                    column_profiles=dataset.column_profiles,  # dynamic profiling data
                )
                assert dataset == expected
                assert len(dataset.preview_rows) == 3
                assert set(dataset.schema_config["fields"].keys()) == {"name", "age", "active"}

    async def test_create_dataset_when_no_name_provided_defaults_to_new_dataset(
        self, seeded_db: AsyncSession, s3_read_write_stubber: Stubber, sample_csv: bytes
    ):
        """create_dataset_from_upload without name should default to 'New Dataset'."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-default-name",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/test_data.csv",
                        original_filename="test_data.csv",
                        file_size=len(sample_csv),
                    )
                ),
            )
        )
        await seeded_db.commit()

        with s3_read_write_stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-default-name",
                partition_fields=["age"],
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_read_write_stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"create_dataset_from_upload should succeed, got: {error}")
            case Success(dataset):
                assert dataset.name == "New Dataset"

    async def test_create_dataset_when_upload_not_found_returns_failure(self, seeded_db: AsyncSession):
        """create_dataset_from_upload should fail when upload_id doesn't exist."""
        set_session(seeded_db)

        result = await create_dataset_from_upload(
            upload_id="nonexistent-upload",
            partition_fields=[],
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), UploadNotFound)

    async def test_create_dataset_when_no_project_returns_failure(self, seeded_db: AsyncSession, sample_csv: bytes):
        """create_dataset_from_upload should fail when project doesn't exist."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-orphan",
                aggregate_id="project-gone",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id="project-gone",
                        dataset_id=None,
                        raw_storage_path="uploads/project-gone/test_data.csv",
                        original_filename="test_data.csv",
                        file_size=len(sample_csv),
                    )
                ),
            )
        )
        await seeded_db.commit()

        result = await create_dataset_from_upload(
            upload_id="upload-orphan",
            partition_fields=[],
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_create_dataset_when_upload_already_processed_returns_failure(
        self, seeded_db: AsyncSession, s3_read_write_stubber: Stubber, sample_csv: bytes
    ):
        """Second call to create_dataset_from_upload should fail because upload is already processed."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-002",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/test_data.csv",
                        original_filename="test_data.csv",
                        file_size=len(sample_csv),
                    )
                ),
            )
        )
        await seeded_db.commit()

        # First call succeeds
        with s3_read_write_stubber:
            first = await create_dataset_from_upload(
                upload_id="upload-002",
                partition_fields=["age"],
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_read_write_stubber.client),
                },
            )
        assert isinstance(first, Success)

        # Second call fails — upload already processed
        second = await create_dataset_from_upload(
            upload_id="upload-002",
            partition_fields=["age"],
        )

        match second:
            case Failure(error):
                assert "Event upload-002 has already been processed" in str(error)
            case _:
                pytest.fail("Expected Failure for already-processed upload")

    async def test_create_dataset_when_file_missing_returns_failure(self, seeded_db: AsyncSession, sample_csv: bytes):
        """create_dataset_from_upload should fail when raw file is missing from S3."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-003",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/gone.csv",
                        original_filename="gone.csv",
                        file_size=len(sample_csv),
                    )
                ),
            )
        )
        await seeded_db.commit()

        empty_stubber = Stubber(boto3.client("s3"))
        empty_stubber.add_response(
            "get_object",
            {
                "Body": io.BytesIO(b""),
            },
            {
                "Bucket": "dashboard-chat.datalake",
                "Key": f"uploads/{PROJECT_1}/gone.csv",
            },
        )

        with empty_stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-003",
                partition_fields=[],
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=empty_stubber.client),
                },
            )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), UploadNotFound)

    async def test_create_dataset_when_csv_is_invalid_returns_failure(self, seeded_db: AsyncSession):
        """create_dataset_from_upload should fail when file content is not valid CSV."""
        set_session(seeded_db)

        bad_content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

        seeded_db.add(
            OutboxRecord(
                id="upload-004",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/bad.csv",
                        original_filename="bad.csv",
                        file_size=len(bad_content),
                    )
                ),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response(
            "get_object",
            {
                "Body": io.BytesIO(bad_content),
            },
            {
                "Bucket": "dashboard-chat.datalake",
                "Key": f"uploads/{PROJECT_1}/bad.csv",
            },
        )

        with stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-004",
                partition_fields=[],
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )

        assert isinstance(result, Failure)
