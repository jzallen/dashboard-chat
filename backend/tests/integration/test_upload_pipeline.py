"""Integration tests for the upload → dataset pipeline across file formats.

Tests the full flow: upload_file → create_dataset_from_upload for each plugin.
Uses seeded_db and S3 stubbers (no external services required).
"""

import io
import json
import zipfile
from functools import partial
from io import BytesIO

import boto3
import pytest
from botocore.stub import Stubber
from openpyxl import Workbook
from returns.result import Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from app.models import Upload
from app.models.dataset import Dataset
from app.plugins import PluginRegistry, create_plugin_registry
from app.repositories import set_session
from app.repositories.lake import MinIOLakeRepository
from app.repositories.metadata import ProjectRecord
from app.use_cases.dataset import create_dataset_from_upload
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.upload import upload_file
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    set_auth_user(TEST_USER)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed with a project."""
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.commit()
    return db_session


@pytest.fixture
def plugin_registry():
    return create_plugin_registry()


def _make_s3_stubber_for_upload(file_content: bytes, storage_path: str, num_partitions: int = 1) -> Stubber:
    """Create an S3 stubber for the full upload → dataset flow.

    Stubs: put_object (raw upload), get_object (read back), put_object * N (parquet writes).
    """
    stubber = Stubber(boto3.client("s3"))
    # upload_file writes raw file
    stubber.add_response("put_object", {})
    # create_dataset_from_upload reads raw file back
    stubber.add_response(
        "get_object",
        {"Body": io.BytesIO(file_content)},
        {"Bucket": "dashboard-chat.datalake", "Key": storage_path},
    )
    # create_dataset_from_upload writes parquet partition(s)
    for _ in range(num_partitions):
        stubber.add_response("put_object", {})
    return stubber


def _make_excel_single_sheet() -> bytes:
    """Create a single-sheet Excel file."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(["name", "age"])
    ws.append(["Alice", 30])
    ws.append(["Bob", 25])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_excel_multi_sheet() -> bytes:
    """Create a multi-sheet Excel file."""
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "Patients"
    ws1.append(["name", "age"])
    ws1.append(["Alice", 30])
    ws2 = wb.create_sheet("Visits")
    ws2.append(["date", "type"])
    ws2.append(["2024-01-01", "checkup"])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _make_hl7_content() -> bytes:
    """Create a simple HL7v2 message."""
    return (
        b"MSH|^~\\&|SndApp|SndFac|RcvApp|RcvFac|20240101120000||ADT^A01|MSG001|P|2.3\r"
        b"PID|||12345^^^MRN||Doe^John||19800101|M\r"
        b"PV1||I|ICU^101^A\r"
    )


def _make_fhir_bundle_single_type() -> bytes:
    """Create a FHIR bundle with only Patient resources."""
    bundle = {
        "resourceType": "Bundle",
        "entry": [
            {"resource": {"resourceType": "Patient", "id": "1", "gender": "male", "birthDate": "1980-01-01"}},
            {"resource": {"resourceType": "Patient", "id": "2", "gender": "female", "birthDate": "1990-05-15"}},
        ],
    }
    return json.dumps(bundle).encode()


def _make_fhir_ndjson_multi_type() -> bytes:
    """Create NDJSON with multiple FHIR resource types."""
    resources = [
        {"resourceType": "Patient", "id": "1", "gender": "male"},
        {"resourceType": "Observation", "id": "2", "status": "final", "code": {"text": "BP"}},
        {"resourceType": "Patient", "id": "3", "gender": "female"},
    ]
    return "\n".join(json.dumps(r) for r in resources).encode()


class TestCsvPipeline:
    """12.1: CSV upload → dataset created (regression)."""

    async def test_csv_upload_creates_dataset(self, seeded_db: AsyncSession, plugin_registry: PluginRegistry):
        set_session(seeded_db)
        csv_content = b"name,age,active\nAlice,30,true\nBob,25,false"

        # Step 1: Upload
        write_stubber = Stubber(boto3.client("s3"))
        write_stubber.add_response("put_object", {})
        with write_stubber:
            upload_result = await upload_file(
                file_content=csv_content,
                file_name="people.csv",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=write_stubber.client)},
            )

        assert isinstance(upload_result, Success)
        upload = upload_result.unwrap()
        assert isinstance(upload, Upload)
        assert upload.status == "pending"
        assert len(upload.preview_rows) == 2

        # Step 2: Create dataset
        upload_id = upload.id
        raw_path = upload.raw_storage_path
        read_write_stubber = Stubber(boto3.client("s3"))
        read_write_stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(csv_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": raw_path},
        )
        read_write_stubber.add_response("put_object", {})  # parquet write

        with read_write_stubber:
            dataset_result = await create_dataset_from_upload(
                upload_id=upload_id,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=read_write_stubber.client)},
            )

        assert isinstance(dataset_result, Success)
        dataset = dataset_result.unwrap()
        assert isinstance(dataset, Dataset)
        assert set(dataset.schema_config["fields"].keys()) == {"name", "age", "active"}
        assert len(dataset.preview_rows) == 2


class TestExcelSingleSheetPipeline:
    """12.2: Excel single-sheet upload → dataset created."""

    async def test_excel_single_sheet_creates_dataset(self, seeded_db: AsyncSession, plugin_registry: PluginRegistry):
        set_session(seeded_db)
        excel_content = _make_excel_single_sheet()

        # Step 1: Upload
        write_stubber = Stubber(boto3.client("s3"))
        write_stubber.add_response("put_object", {})
        with write_stubber:
            upload_result = await upload_file(
                file_content=excel_content,
                file_name="data.xlsx",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=write_stubber.client)},
            )

        assert isinstance(upload_result, Success)
        upload = upload_result.unwrap()
        assert upload.status == "pending"  # single sheet, no choices needed
        assert len(upload.preview_rows) == 2

        # Step 2: Create dataset
        upload_id = upload.id
        raw_path = upload.raw_storage_path
        read_write_stubber = Stubber(boto3.client("s3"))
        read_write_stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(excel_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": raw_path},
        )
        read_write_stubber.add_response("put_object", {})

        with read_write_stubber:
            dataset_result = await create_dataset_from_upload(
                upload_id=upload_id,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=read_write_stubber.client)},
            )

        assert isinstance(dataset_result, Success)
        dataset = dataset_result.unwrap()
        assert set(dataset.schema_config["fields"].keys()) == {"name", "age"}


class TestExcelMultiSheetPipeline:
    """12.3: Excel multi-sheet → choices → select → dataset created."""

    async def test_excel_multi_sheet_with_choices_creates_dataset(
        self, seeded_db: AsyncSession, plugin_registry: PluginRegistry
    ):
        set_session(seeded_db)
        excel_content = _make_excel_multi_sheet()

        # Step 1: Upload → should return awaiting_input with choices
        write_stubber = Stubber(boto3.client("s3"))
        write_stubber.add_response("put_object", {})
        with write_stubber:
            upload_result = await upload_file(
                file_content=excel_content,
                file_name="multi.xlsx",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=write_stubber.client)},
            )

        assert isinstance(upload_result, Success)
        upload = upload_result.unwrap()
        assert upload.status == "awaiting_input"
        assert upload.choices is not None
        assert len(upload.choices) > 0
        # Verify sheet names are in choices
        choice_options = upload.choices[0].get("options", [])
        assert "Patients" in choice_options
        assert "Visits" in choice_options

        # Step 2: Process with user's choice (select "Patients" sheet)
        upload_id = upload.id
        raw_path = upload.raw_storage_path
        read_write_stubber = Stubber(boto3.client("s3"))
        read_write_stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(excel_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": raw_path},
        )
        read_write_stubber.add_response("put_object", {})

        with read_write_stubber:
            dataset_result = await create_dataset_from_upload(
                upload_id=upload_id,
                plugin_registry=plugin_registry,
                choices={"sheet_name": "Patients"},
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=read_write_stubber.client)},
            )

        assert isinstance(dataset_result, Success)
        dataset = dataset_result.unwrap()
        assert set(dataset.schema_config["fields"].keys()) == {"name", "age"}


class TestHl7v2Pipeline:
    """12.4: HL7 file upload → dataset with flattened columns."""

    async def test_hl7_upload_creates_dataset_with_flattened_columns(
        self, seeded_db: AsyncSession, plugin_registry: PluginRegistry
    ):
        set_session(seeded_db)
        hl7_content = _make_hl7_content()

        # Step 1: Upload
        write_stubber = Stubber(boto3.client("s3"))
        write_stubber.add_response("put_object", {})
        with write_stubber:
            upload_result = await upload_file(
                file_content=hl7_content,
                file_name="messages.hl7",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=write_stubber.client)},
            )

        assert isinstance(upload_result, Success)
        upload = upload_result.unwrap()
        assert upload.status == "pending"

        # Step 2: Create dataset
        upload_id = upload.id
        raw_path = upload.raw_storage_path
        read_write_stubber = Stubber(boto3.client("s3"))
        read_write_stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(hl7_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": raw_path},
        )
        read_write_stubber.add_response("put_object", {})

        with read_write_stubber:
            dataset_result = await create_dataset_from_upload(
                upload_id=upload_id,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=read_write_stubber.client)},
            )

        assert isinstance(dataset_result, Success)
        dataset = dataset_result.unwrap()
        # Verify HL7 segment columns exist
        fields = set(dataset.schema_config["fields"].keys())
        assert any(f.startswith("MSH_") for f in fields), f"Expected MSH columns, got: {fields}"
        assert any(f.startswith("PID_") for f in fields), f"Expected PID columns, got: {fields}"
        assert any(f.startswith("PV1_") for f in fields), f"Expected PV1 columns, got: {fields}"
        # Verify format_context is set
        assert dataset.format_context is not None
        assert "HL7" in dataset.format_context


class TestFhirPipeline:
    """12.5: FHIR NDJSON upload → resource type selection → dataset created."""

    async def test_fhir_ndjson_multi_type_with_choices_creates_dataset(
        self, seeded_db: AsyncSession, plugin_registry: PluginRegistry
    ):
        set_session(seeded_db)
        fhir_content = _make_fhir_ndjson_multi_type()

        # Step 1: Upload → should return awaiting_input (multiple resource types)
        write_stubber = Stubber(boto3.client("s3"))
        write_stubber.add_response("put_object", {})
        with write_stubber:
            upload_result = await upload_file(
                file_content=fhir_content,
                file_name="bundle.ndjson",
                project_id=PROJECT_1,
                plugin_registry=plugin_registry,
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=write_stubber.client)},
            )

        assert isinstance(upload_result, Success)
        upload = upload_result.unwrap()
        assert upload.status == "awaiting_input"
        assert upload.choices is not None

        # Step 2: Process with choice (select "Patient" resource type)
        upload_id = upload.id
        raw_path = upload.raw_storage_path
        read_write_stubber = Stubber(boto3.client("s3"))
        read_write_stubber.add_response(
            "get_object",
            {"Body": io.BytesIO(fhir_content)},
            {"Bucket": "dashboard-chat.datalake", "Key": raw_path},
        )
        read_write_stubber.add_response("put_object", {})

        with read_write_stubber:
            dataset_result = await create_dataset_from_upload(
                upload_id=upload_id,
                plugin_registry=plugin_registry,
                choices={"resource_type": "Patient"},
                repositories={"lake_repository": partial(MinIOLakeRepository, s3_client=read_write_stubber.client)},
            )

        assert isinstance(dataset_result, Success)
        dataset = dataset_result.unwrap()
        fields = set(dataset.schema_config["fields"].keys())
        assert "resource_type" in fields
        assert "id" in fields
        assert "gender" in fields
        assert dataset.format_context is not None


class TestDbtExportWithMixedFormats:
    """12.6: dbt export with mixed-format datasets → valid zip with plugin macros."""

    def test_export_with_plugin_macros_produces_valid_zip(self, plugin_registry: PluginRegistry):
        from app.models.project import Project

        # Create project with datasets that have format_context
        ds_csv = Dataset(
            id="ds-csv",
            project_id="proj-1",
            name="CSV Data",
            schema_config={"fields": {"name": {"type": "text"}}},
            transforms=[],
        )
        ds_hl7 = Dataset(
            id="ds-hl7",
            project_id="proj-1",
            name="HL7 Messages",
            schema_config={"fields": {"msh_3": {"type": "text"}, "pid_5": {"type": "text"}}},
            transforms=[],
            format_context="HL7v2 format context",
        )
        project = Project(id="proj-1", name="Mixed Format Project", datasets=[ds_csv, ds_hl7])

        zip_bytes = generate_dbt_project_zip(project, "mixed_format_project", plugin_registry)
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        # Core files present
        assert "dbt_project.yml" in names
        assert "models/staging/stg_csv_data.sql" in names
        assert "models/staging/stg_hl7_messages.sql" in names

        # Plugin macros present (HL7v2 plugin has dbt_macros)
        plugin_macro_files = [n for n in names if n.startswith("macros/plugin_")]
        assert len(plugin_macro_files) > 0, "Expected plugin macro files in zip"

        # Verify zip is valid
        for name in zf.namelist():
            zf.read(name).decode("utf-8")  # All files should be valid UTF-8
