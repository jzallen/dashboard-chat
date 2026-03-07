import io
from dataclasses import asdict
from functools import partial
from typing import ClassVar

import boto3
import pandas as pd
import pytest
from botocore.stub import Stubber
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.plugins import PluginRegistry
from app.plugins.protocol import MultiProcessingResult, ProcessingResult
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


# ---------------------------------------------------------------------------
# Mock plugins for plugin-based tests
# ---------------------------------------------------------------------------


class MockSinglePlugin:
    """Mock plugin that returns a single ProcessingResult."""

    name = "mock_single"
    extensions: ClassVar[list[str]] = [".mock"]
    label = "Mock Single"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        df = pd.DataFrame({"x": [1, 2], "y": ["a", "b"]})
        return ProcessingResult(df=df, name="Plugin Dataset")


class MockMultiPlugin:
    """Mock plugin that returns a MultiProcessingResult with two datasets."""

    name = "mock_multi"
    extensions: ClassVar[list[str]] = [".mmock"]
    label = "Mock Multi"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        df_a = pd.DataFrame({"col": [1, 2, 3]})
        df_b = pd.DataFrame({"col": [4, 5]})
        return MultiProcessingResult(
            results=[
                ProcessingResult(df=df_a, name="Type A"),
                ProcessingResult(df=df_b, name="Type B"),
            ]
        )


class MockMultiPluginSecondFails:
    """Mock plugin that returns MultiProcessingResult where second dataset will fail during write."""

    name = "mock_multi_fail"
    extensions: ClassVar[list[str]] = [".mfail"]
    label = "Mock Multi Fail"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        df_a = pd.DataFrame({"col": [1, 2, 3]})
        df_b = pd.DataFrame({"col": [4, 5]})
        return MultiProcessingResult(
            results=[
                ProcessingResult(df=df_a, name="Good Type"),
                ProcessingResult(df=df_b, name="Bad Type"),
            ]
        )


class MockConvertedPlugin:
    """Mock plugin that sets _converted_content after process()."""

    name = "mock_converted"
    extensions: ClassVar[list[str]] = [".cmock"]
    label = "Mock Converted"
    dbt_macros = None

    def __init__(self):
        self._converted_content: bytes | None = None

    def validate(self, file_content: bytes, filename: str) -> None:
        pass

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        self._converted_content = b'{"resourceType":"Bundle"}'
        df = pd.DataFrame({"id": ["p1"], "status": ["active"]})
        return ProcessingResult(df=df, name="Converted Dataset")


# ---------------------------------------------------------------------------
# Plugin-based tests (task 5.7)
# ---------------------------------------------------------------------------


class TestCreateDatasetFromUploadWithPlugins:
    """Tests for create_dataset_from_upload with PluginRegistry."""

    async def test_single_dataset_plugin_returns_dataset_with_plugin_name(self, seeded_db: AsyncSession):
        """Plugin returning ProcessingResult should create a single Dataset with the plugin-provided name."""
        set_session(seeded_db)

        raw_content = b"raw file bytes"
        seeded_db.add(
            OutboxRecord(
                id="upload-plugin-single",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/data.mock",
                        original_filename="data.mock",
                        file_size=len(raw_content),
                        plugin_name="mock_single",
                    )
                ),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(raw_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": f"uploads/{PROJECT_1}/data.mock"},
        )
        # One put_object for the single parquet write (no partition fields)
        stubber.add_response("put_object", {})

        registry = PluginRegistry([MockSinglePlugin()])

        with stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-plugin-single",
                partition_fields=[],
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
            case Success(dataset):
                assert isinstance(dataset, Dataset)
                assert dataset.name == "Plugin Dataset"
                assert dataset.project_id == PROJECT_1
                assert set(dataset.schema_config["fields"].keys()) == {"x", "y"}

    async def test_multi_dataset_plugin_returns_list_of_datasets(self, seeded_db: AsyncSession):
        """Plugin returning MultiProcessingResult should create multiple Datasets."""
        set_session(seeded_db)

        raw_content = b"raw multi file"
        seeded_db.add(
            OutboxRecord(
                id="upload-plugin-multi",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/data.mmock",
                        original_filename="data.mmock",
                        file_size=len(raw_content),
                        plugin_name="mock_multi",
                    )
                ),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(raw_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": f"uploads/{PROJECT_1}/data.mmock"},
        )
        # Two put_object calls: one per dataset (no partition fields)
        stubber.add_response("put_object", {})
        stubber.add_response("put_object", {})

        registry = PluginRegistry([MockMultiPlugin()])

        with stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-plugin-multi",
                partition_fields=[],
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
            case Success(datasets):
                assert isinstance(datasets, list)
                assert len(datasets) == 2
                assert datasets[0].name == "Type A"
                assert datasets[1].name == "Type B"
                assert all(d.project_id == PROJECT_1 for d in datasets)

    async def test_converted_storage_path_persisted_in_outbox(self, seeded_db: AsyncSession):
        """Plugin with _converted_content should trigger converted_storage_path update in outbox."""
        set_session(seeded_db)

        raw_content = b"raw converted file"
        seeded_db.add(
            OutboxRecord(
                id="upload-plugin-converted",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/data.cmock",
                        original_filename="data.cmock",
                        file_size=len(raw_content),
                        plugin_name="mock_converted",
                    )
                ),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(raw_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": f"uploads/{PROJECT_1}/data.cmock"},
        )
        # put_object for the converted file write
        stubber.add_response("put_object", {})
        # put_object for the parquet write
        stubber.add_response("put_object", {})

        registry = PluginRegistry([MockConvertedPlugin()])

        with stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-plugin-converted",
                partition_fields=[],
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )

        match result:
            case Failure(error):
                pytest.fail(f"Expected success, got: {error}")
            case Success(dataset):
                assert isinstance(dataset, Dataset)
                assert dataset.name == "Converted Dataset"

        # Verify the outbox record was updated with converted_storage_path
        record = await seeded_db.get(OutboxRecord, "upload-plugin-converted")
        assert record is not None
        assert record.payload.get("converted_storage_path") == (f"uploads/{PROJECT_1}/data.converted.fhir.json")

    async def test_multi_dataset_partial_failure_returns_failure(self, seeded_db: AsyncSession):
        """If the second dataset write fails, the use case should return Failure.

        Note: The @handle_returns decorator catches the exception and returns Failure
        before @with_repositories can roll back. This means the first dataset's metadata
        record may persist. Full transactional atomicity for multi-dataset writes would
        require rolling back inside handle_returns or using savepoints.
        """
        set_session(seeded_db)

        raw_content = b"raw multi fail file"
        seeded_db.add(
            OutboxRecord(
                id="upload-plugin-rollback",
                aggregate_id=PROJECT_1,
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(
                    UploadFileReceived(
                        project_id=PROJECT_1,
                        dataset_id=None,
                        raw_storage_path=f"uploads/{PROJECT_1}/data.mfail",
                        original_filename="data.mfail",
                        file_size=len(raw_content),
                        plugin_name="mock_multi_fail",
                    )
                ),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(raw_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": f"uploads/{PROJECT_1}/data.mfail"},
        )
        # First parquet write succeeds
        stubber.add_response("put_object", {})
        # Second parquet write raises an error (simulate S3 failure)
        stubber.add_client_error(
            "put_object",
            service_error_code="InternalError",
            service_message="Simulated S3 failure",
        )

        registry = PluginRegistry([MockMultiPluginSecondFails()])

        with stubber:
            result = await create_dataset_from_upload(
                upload_id="upload-plugin-rollback",
                partition_fields=[],
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )

        # Should be a Failure due to the S3 error on second write
        assert isinstance(result, Failure)
        assert "InternalError" in str(result.failure()) or "S3" in str(result.failure())
