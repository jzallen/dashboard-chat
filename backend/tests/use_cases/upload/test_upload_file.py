from functools import partial
from typing import ClassVar

import boto3
import pandas as pd
import pytest
from botocore.stub import Stubber
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Upload
from app.plugins import PluginRegistry, create_plugin_registry
from app.plugins.protocol import (
    MultiProcessingResult,
    PluginChoice,
    PluginValidationError,
    ProcessingResult,
)
from app.repositories import set_session
from app.repositories.lake import MinIOLakeRepository
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.upload import upload_file
from app.use_cases.upload.exceptions import EmptyFile, UnsupportedFormat
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1


@pytest.fixture
def sample_csv() -> bytes:
    return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"


@pytest.fixture
def s3_write_stubber() -> Stubber:
    stubber = Stubber(boto3.client("s3"))
    stubber.add_response("put_object", {})
    return stubber


@pytest.fixture
def plugin_registry():
    return create_plugin_registry()


class TestUploadFile:
    """Tests for upload_file use case."""

    async def test_upload_when_valid_csv_creates_upload_with_preview(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes, plugin_registry
    ):
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
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
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber, sample_csv: bytes, plugin_registry
    ):
        set_session(seeded_db)

        with s3_write_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                dataset_id=DATASET_1,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        assert isinstance(result, Success)
        assert result.unwrap().dataset_id == DATASET_1

    async def test_upload_when_unsupported_format_raises_unsupported_format(
        self, seeded_db: AsyncSession, sample_csv: bytes, plugin_registry
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.txt",
            project_id=PROJECT_1,
            plugin_registry=plugin_registry,
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), UnsupportedFormat)

    async def test_upload_when_empty_file_raises_empty_file(self, seeded_db: AsyncSession, plugin_registry):
        set_session(seeded_db)

        result = await upload_file(
            file_content=b"",
            file_name="empty.csv",
            project_id=PROJECT_1,
            plugin_registry=plugin_registry,
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), EmptyFile)

    async def test_upload_when_project_missing_raises_project_not_found(
        self, seeded_db: AsyncSession, sample_csv: bytes, plugin_registry
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="nonexistent-project",
            plugin_registry=plugin_registry,
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_upload_when_dataset_missing_raises_dataset_not_found(
        self, seeded_db: AsyncSession, sample_csv: bytes, plugin_registry
    ):
        set_session(seeded_db)

        result = await upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id=PROJECT_1,
            plugin_registry=plugin_registry,
            dataset_id="nonexistent-dataset",
        )

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), DatasetNotFound)

    # NOTE: org mismatch test removed — authorization moved to router layer


# ---------------------------------------------------------------------------
# Mock plugins for characterization tests
# ---------------------------------------------------------------------------


class _MockChoicesPlugin:
    """Plugin whose detect_choices returns a non-None list of PluginChoice."""

    name = "mock_choices"
    extensions: ClassVar[list[str]] = [".chmock"]
    label = "Mock Choices"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        return None

    def detect_choices(self, file_content: bytes, filename: str):
        return [PluginChoice(key="sheet_name", label="Pick a sheet", options=["Sheet1", "Sheet2"])]

    def process(self, file_content: bytes, filename: str, choices=None):
        # Should not be called in the choices-required flow.
        return ProcessingResult(df=pd.DataFrame({"x": [1]}), name="Should Not Be Used")


class _MockMultiPreviewPlugin:
    """Plugin returning MultiProcessingResult so we can pin first-dataset preview behaviour."""

    name = "mock_multi_preview"
    extensions: ClassVar[list[str]] = [".mpmock"]
    label = "Mock Multi Preview"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        return None

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        df_first = pd.DataFrame({"col": ["first_a", "first_b"]})
        df_second = pd.DataFrame({"col": ["second_a", "second_b"]})
        return MultiProcessingResult(
            results=[
                ProcessingResult(df=df_first, name="First"),
                ProcessingResult(df=df_second, name="Second"),
            ]
        )


class _MockTimeoutValidatePlugin:
    """Plugin whose validate raises TimeoutError synchronously."""

    name = "mock_timeout"
    extensions: ClassVar[list[str]] = [".tomock"]
    label = "Mock Timeout"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        raise TimeoutError("simulated slow validation")

    def detect_choices(self, file_content: bytes, filename: str):
        return None

    def process(self, file_content: bytes, filename: str, choices=None):
        return ProcessingResult(df=pd.DataFrame({"x": [1]}), name="Unused")


# ---------------------------------------------------------------------------
# Characterization tests — pin CURRENT behavior of upload_file (bead dc-89fx).
# Do NOT change these to "should" expectations; they describe what the code
# does today so upcoming refactors can be checked against them.
# ---------------------------------------------------------------------------


class TestUploadFileCharacterization:
    """Characterization tests pinning the CURRENT behavior of upload_file.

    See bead dc-89fx. These tests describe what the code does today, not
    what it ideally should do. Refactors in follow-up beads must keep them
    green or consciously decide to update them.
    """

    async def test_upload_when_plugin_requests_choices_returns_awaiting_input_with_empty_preview(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber
    ):
        """Pin: detect_choices returning a non-None list yields awaiting_input + empty preview + choices populated."""
        set_session(seeded_db)

        registry = PluginRegistry([_MockChoicesPlugin()])
        with s3_write_stubber:
            result = await upload_file(
                file_content=b"unused content",
                file_name="data.chmock",
                project_id=PROJECT_1,
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        assert isinstance(result, Success)
        upload = result.unwrap()
        assert upload.status == "awaiting_input"
        assert upload.preview_rows == []
        assert upload.choices == [
            {"key": "sheet_name", "label": "Pick a sheet", "options": ["Sheet1", "Sheet2"]}
        ]

    async def test_upload_when_multi_processing_result_uses_first_dataset_for_preview(
        self, seeded_db: AsyncSession, s3_write_stubber: Stubber
    ):
        """Pin: with MultiProcessingResult and no choices, preview_rows come from results[0].df.head(10)."""
        set_session(seeded_db)

        registry = PluginRegistry([_MockMultiPreviewPlugin()])
        with s3_write_stubber:
            result = await upload_file(
                file_content=b"any bytes",
                file_name="data.mpmock",
                project_id=PROJECT_1,
                plugin_registry=registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=s3_write_stubber.client),
                },
            )

        assert isinstance(result, Success)
        upload = result.unwrap()
        # Preview rows are taken from the FIRST dataset only — not the second, not concatenated.
        assert upload.preview_rows == [{"col": "first_a"}, {"col": "first_b"}]
        # Status remains the default ("pending"), not "awaiting_input".
        assert upload.status == "pending"

    async def test_upload_when_plugin_validate_raises_timeout_error_wraps_in_plugin_validation_error(
        self, seeded_db: AsyncSession
    ):
        """Pin: TimeoutError from plugin.validate (via asyncio.wait_for) is wrapped in PluginValidationError.

        Current behavior: the wrapped error message is f"Plugin '{plugin.name}' validation timed out".
        """
        set_session(seeded_db)

        registry = PluginRegistry([_MockTimeoutValidatePlugin()])
        result = await upload_file(
            file_content=b"any",
            file_name="data.tomock",
            project_id=PROJECT_1,
            plugin_registry=registry,
        )

        assert isinstance(result, Failure)
        err = result.failure()
        assert isinstance(err, PluginValidationError)
        assert "mock_timeout" in str(err)
        assert "timed out" in str(err)

    async def test_upload_persists_outbox_payload_with_file_size_and_uploads_path_shape(
        self, seeded_db: AsyncSession, sample_csv: bytes, plugin_registry
    ):
        """Pin: outbox-derived Upload exposes file_size == len(content) and raw_storage_path == 'uploads/<project>/<filename>'.

        Verified at the put_object boundary too: lake.write_raw_file is called with the SAME key the outbox generated,
        and the bucket is the configured datalake bucket.
        """
        set_session(seeded_db)

        expected_key = f"uploads/{PROJECT_1}/checked.csv"
        strict_stubber = Stubber(boto3.client("s3"))
        strict_stubber.add_response(
            "put_object",
            {},
            {
                "Bucket": "dashboard-chat.datalake",
                "Key": expected_key,
                "Body": sample_csv,
                "ContentType": "application/octet-stream",
            },
        )

        with strict_stubber:
            result = await upload_file(
                file_content=sample_csv,
                file_name="checked.csv",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={
                    "lake_repository": partial(MinIOLakeRepository, s3_client=strict_stubber.client),
                },
            )

        assert isinstance(result, Success)
        upload = result.unwrap()
        assert upload.file_size == len(sample_csv)
        assert upload.original_filename == "checked.csv"
        assert upload.raw_storage_path == expected_key
        # Stubber assert_no_pending_responses inside the with-block: if the put_object
        # had been called with a different Bucket/Key/Body, the stubber would have
        # raised before reaching here.
