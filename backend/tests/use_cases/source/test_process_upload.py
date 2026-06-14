"""Tests for the process_upload use case (slice 2).

Port-to-port: enters through the use-case driving port, asserts on the
returned Dataset / awaiting_input marker and the driven-port outcomes
(dataset linked to source via source_id, source schema updated, UploadRecorded
marked processed, DatasetSyncRequested emitted).

The lake and plugin registry are port doubles. The lake double's
``read_raw_file`` returns the uploaded bytes the browser PUT directly to MinIO
(the app server reads them back at process time); ``write_csv_as_partitioned_parquet``
records writes. This is the ingestion path the synchronous flow already uses.
"""

import io
from typing import ClassVar

import pandas as pd
import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.plugins import PluginRegistry
from app.plugins.protocol import PluginChoice, ProcessingResult
from app.repositories import RestrictedSession, set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.repositories.outbox import OutboxRecord, OutboxRepository
from app.use_cases.source import process_upload, record_upload
from app.use_cases.source.exceptions import UploadNotPending
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")

SAMPLE_CSV = b"name,age,active\nAlice,30,true\nBob,25,false"


class _FakeLakeRepo:
    """Lake port double: serves uploaded bytes back and records parquet writes."""

    def __init__(self, raw: bytes = SAMPLE_CSV):
        self._raw = raw
        self.parquet_writes: list = []

    def presigned_put_url(self, storage_key, content_type, expires_in) -> str:
        return f"http://minio.public/bucket/{storage_key}?sig=x"

    def read_raw_file(self, storage_path: str) -> bytes:
        return self._raw

    def write_csv_as_partitioned_parquet(self, csv_content, storage_prefix, partition_fields) -> str:
        self.parquet_writes.append((storage_prefix, partition_fields, csv_content))
        return f"s3://bucket/{storage_prefix}"


class _ExcelLikePlugin:
    """Plugin that requires a sheet choice before it can process (awaiting_input)."""

    name = "fake_excel"
    extensions: ClassVar[list[str]] = [".xlsx"]
    label = "Fake Excel"
    dbt_macros = None

    def validate(self, file_content: bytes, filename: str) -> None:
        return None

    def detect_choices(self, file_content: bytes, filename: str):
        return [PluginChoice(key="sheet_name", label="Select a sheet", options=["Sheet1", "Sheet2"])]

    def process(self, file_content: bytes, filename: str, choices=None):
        sheet = (choices or {}).get("sheet_name", "Sheet1")
        return ProcessingResult(df=pd.DataFrame({"sheet": [sheet], "x": [1]}), name=f"Data {sheet}")


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.commit()
    return db_session


async def _make_source(db_session: AsyncSession, name: str = "Patients") -> str:
    from app.use_cases.source import create_source

    return (await create_source(project_id=PROJECT_1, name=name, user=TEST_USER)).unwrap()["id"]


async def _record(db_session, source_id: str, lake, filename="patients.csv", content_type="text/csv") -> str:
    result = await record_upload(
        source_id=source_id,
        filename=filename,
        content_type=content_type,
        file_size=len(SAMPLE_CSV),
        user=TEST_USER,
        repositories={"lake_repository": lambda: lake},
    )
    return result.unwrap()["upload_id"]


class TestProcessUpload:
    async def test_first_upload_creates_dataset_linked_to_source(self, seeded_db: AsyncSession):
        """First upload for a source ingests the file and creates a Dataset linked via source_id."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        match result:
            case Success(dataset):
                assert dataset.source_id == source_id
                assert dataset.project_id == PROJECT_1
                assert set(dataset.schema_config["fields"].keys()) == {"name", "age", "active"}
                # Provenance partition stays internal: the stored schema and
                # partition_fields never carry upload_id.
                assert "upload_id" not in dataset.schema_config["fields"]
                assert "upload_id" not in dataset.dataset.partition_fields
                assert lake.parquet_writes, "expected the CSV to be ingested to parquet"
                # The first/link upload writes under the per-upload hive partition
                # at the dataset's BASE storage_path (no manual sub-prefix), with
                # upload_id appended to the partition fields and present as a
                # constant column in the written CSV.
                prefix, partition_fields, csv_content = lake.parquet_writes[0]
                assert prefix == f"datasets/{dataset.project_id}/{dataset.id}/"
                assert "upload_id" in partition_fields
                written = pd.read_csv(io.BytesIO(csv_content))
                assert (written["upload_id"].astype(str) == upload_id).all()
            case Failure(error):
                pytest.fail(f"process_upload should succeed, got: {error}")

    async def test_first_upload_seeds_display_name_from_source_name(self, seeded_db: AsyncSession):
        """Linking a first upload seeds the dataset's editable display_name from the
        title-cased Source name, leaving the immutable filename ``name`` unchanged."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db, name="customers.csv")
        upload_id = await _record(seeded_db, source_id, lake)

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        match result:
            case Success(dataset):
                assert dataset.dataset.display_name == "Customers"
                # The default plugin path leaves ``name`` as the placeholder — the
                # filename/name is never derived from the source title.
                assert dataset.name == "New Dataset"
            case Failure(error):
                pytest.fail(f"process_upload should succeed, got: {error}")

    async def test_first_upload_stamps_row_count_into_upload_event_payload(self, seeded_db: AsyncSession):
        """The ingested row count is stamped into the UploadRecorded event's payload."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()  # SAMPLE_CSV has 2 data rows
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        record = (
            (await seeded_db.execute(select(OutboxRecord).where(OutboxRecord.aggregate_id == upload_id)))
            .scalars()
            .one()
        )
        assert record.payload["row_count"] == 2

    async def test_append_stamps_row_count_into_its_own_upload_event_payload(self, seeded_db: AsyncSession):
        """A subsequent matching upload stamps ITS incoming row count (not the cumulative total)."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        first_upload = await _record(seeded_db, source_id, lake)
        await process_upload(
            source_id=source_id, upload_id=first_upload, repositories={"lake_repository": lambda: lake}
        )

        more_csv = b"name,age,active\nCarol,40,true\nDave,22,false\nEve,33,true"  # 3 rows
        more_lake = _FakeLakeRepo(raw=more_csv)
        second_upload = await _record(seeded_db, source_id, more_lake, filename="more.csv")
        await process_upload(
            source_id=source_id, upload_id=second_upload, repositories={"lake_repository": lambda: more_lake}
        )

        record = (
            (await seeded_db.execute(select(OutboxRecord).where(OutboxRecord.aggregate_id == second_upload)))
            .scalars()
            .one()
        )
        assert record.payload["row_count"] == 3

    async def test_first_upload_updates_source_schema(self, seeded_db: AsyncSession):
        """First upload locks the inferred schema onto the Source for later matching."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        from app.repositories.metadata import MetadataRepository

        repo = MetadataRepository(seeded_db)
        source = await repo.get_source(source_id)
        assert set(source["schema_config"]["fields"].keys()) == {"name", "age", "active"}

    async def test_marks_upload_recorded_processed(self, seeded_db: AsyncSession):
        """After ingestion the pending UploadRecorded event is marked processed."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        outbox = OutboxRepository(RestrictedSession(seeded_db))
        pending = await outbox.get_pending_event("upload", upload_id, "UploadRecorded")
        assert pending is None, "UploadRecorded should be marked processed after ingestion"

    async def test_emits_dataset_sync_requested_when_sql_access_enabled(self, seeded_db: AsyncSession):
        """A DatasetSyncRequested event is emitted for the new dataset when SQL access is enabled."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        class _FakeExternalEnabled:
            async def get_active_engine_node_id(self, project_id: str):
                return "engine-007"

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={
                "lake_repository": lambda: lake,
                "external_access_repository": lambda: _FakeExternalEnabled(),
            },
        )
        dataset = result.unwrap()

        rows = (
            (await seeded_db.execute(select(OutboxRecord).where(OutboxRecord.event_type == "DatasetSyncRequested")))
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].payload["dataset_id"] == dataset.id
        assert rows[0].payload["engine_node_id"] == "engine-007"

    async def test_awaiting_input_returns_choices_without_creating_dataset(self, seeded_db: AsyncSession):
        """When the plugin needs a choice and none is provided, return awaiting_input with choices."""
        set_session(seeded_db)
        lake = _FakeLakeRepo(raw=b"binary-xlsx-bytes")
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake, filename="book.xlsx", content_type="application/xlsx")
        registry = PluginRegistry([_ExcelLikePlugin()])

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            plugin_registry=registry,
            repositories={"lake_repository": lambda: lake},
        )

        match result:
            case Success(data):
                assert data["status"] == "awaiting_input"
                assert data["choices"][0]["key"] == "sheet_name"
                assert data["choices"][0]["options"] == ["Sheet1", "Sheet2"]
                # No parquet written — ingestion did not run.
                assert lake.parquet_writes == []
            case Failure(error):
                pytest.fail(f"awaiting_input path should be a Success marker, got: {error}")

    async def test_awaiting_input_proceeds_when_choices_provided(self, seeded_db: AsyncSession):
        """Supplying the choice lets ingestion proceed and a Dataset is created."""
        set_session(seeded_db)
        lake = _FakeLakeRepo(raw=b"binary-xlsx-bytes")
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake, filename="book.xlsx", content_type="application/xlsx")
        registry = PluginRegistry([_ExcelLikePlugin()])

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            plugin_registry=registry,
            choices={"sheet_name": "Sheet2"},
            repositories={"lake_repository": lambda: lake},
        )

        match result:
            case Success(dataset):
                assert dataset.source_id == source_id
                assert dataset.name == "Data Sheet2"
            case Failure(error):
                pytest.fail(f"process_upload with choices should succeed, got: {error}")

    async def test_first_upload_returns_status_linked(self, seeded_db: AsyncSession):
        """The first upload reports status 'linked' (vs 'appended' for subsequent matches)."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)
        upload_id = await _record(seeded_db, source_id, lake)

        result = await process_upload(
            source_id=source_id,
            upload_id=upload_id,
            repositories={"lake_repository": lambda: lake},
        )

        dataset = result.unwrap()
        assert dataset.status == "linked"

    async def test_subsequent_matching_upload_appends_to_existing_dataset(self, seeded_db: AsyncSession):
        """A second upload whose schema matches the source appends parquet to the
        SAME dataset prefix, bumps row_count, reports status 'appended', and reuses
        the existing dataset id (no new dataset)."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)

        first_upload = await _record(seeded_db, source_id, lake)
        first = (
            await process_upload(
                source_id=source_id,
                upload_id=first_upload,
                repositories={"lake_repository": lambda: lake},
            )
        ).unwrap()
        first_dataset_id = first.id
        writes_after_first = len(lake.parquet_writes)

        # SAME schema (name,age,active), different rows.
        more_csv = b"name,age,active\nCarol,40,true\nDave,22,false\nEve,33,true"
        more_lake = _FakeLakeRepo(raw=more_csv)
        second_upload = await _record(seeded_db, source_id, more_lake, filename="more.csv")
        result = await process_upload(
            source_id=source_id,
            upload_id=second_upload,
            repositories={"lake_repository": lambda: more_lake},
        )

        match result:
            case Success(dataset):
                assert dataset.status == "appended"
                assert dataset.id == first_dataset_id, "append must reuse the existing dataset"
                # Append writes to the dataset's BASE storage prefix (NOT a manual
                # {storage_path}{upload_id}/ sub-prefix) under a per-upload hive
                # partition. The reader globs **/*.parquet across the base prefix,
                # so the new partition accumulates alongside earlier uploads.
                assert more_lake.parquet_writes, "expected an append parquet write"
                prefix, partition_fields, csv_content = more_lake.parquet_writes[0]
                assert prefix == f"datasets/{dataset.project_id}/{dataset.id}/"
                assert first_dataset_id in prefix
                assert not prefix.endswith(f"{second_upload}/"), "no manual upload_id sub-prefix"
                # upload_id is the per-upload provenance partition, present as a
                # constant column in the written CSV but excluded from the dataset's
                # stored schema/partition_fields.
                assert "upload_id" in partition_fields
                written = pd.read_csv(io.BytesIO(csv_content))
                assert (written["upload_id"].astype(str) == second_upload).all()
                assert "upload_id" not in dataset.schema_config.get("fields", {})
                assert "upload_id" not in dataset.dataset.partition_fields
                # row_count grew by the appended rows (2 + 3 = 5).
                from app.repositories.metadata import MetadataRepository

                repo = MetadataRepository(seeded_db)
                refreshed = await repo.get_dataset(first_dataset_id)
                assert refreshed["row_count"] == 5
            case Failure(error):
                pytest.fail(f"matching subsequent upload should append, got: {error}")
        # The first write happened during the first upload; this asserts we didn't
        # create a second dataset record (still one dataset for the source).
        assert writes_after_first == 1

    async def test_subsequent_matching_upload_emits_dataset_sync(self, seeded_db: AsyncSession):
        """Appending a matching upload re-emits DatasetSyncRequested for the dataset."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)

        class _FakeExternalEnabled:
            async def get_active_engine_node_id(self, project_id: str):
                return "engine-007"

        repos = {
            "lake_repository": lambda: lake,
            "external_access_repository": lambda: _FakeExternalEnabled(),
        }
        first_upload = await _record(seeded_db, source_id, lake)
        first = (await process_upload(source_id=source_id, upload_id=first_upload, repositories=repos)).unwrap()

        more_lake = _FakeLakeRepo()
        second_upload = await _record(seeded_db, source_id, more_lake, filename="more.csv")
        await process_upload(
            source_id=source_id,
            upload_id=second_upload,
            repositories={
                "lake_repository": lambda: more_lake,
                "external_access_repository": lambda: _FakeExternalEnabled(),
            },
        )

        rows = (
            (await seeded_db.execute(select(OutboxRecord).where(OutboxRecord.event_type == "DatasetSyncRequested")))
            .scalars()
            .all()
        )
        # One from first upload, one from the append.
        assert len(rows) == 2
        assert all(r.payload["dataset_id"] == first.id for r in rows)

    async def test_subsequent_mismatched_upload_fails_with_schema_mismatch(self, seeded_db: AsyncSession):
        """A second upload whose schema differs from the source's locked schema
        fails with SchemaMismatch carrying the column detail, and does NOT append."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)

        first_upload = await _record(seeded_db, source_id, lake)
        await process_upload(
            source_id=source_id,
            upload_id=first_upload,
            repositories={"lake_repository": lambda: lake},
        )

        # Mismatched: drops 'active', adds 'email'.
        bad_csv = b"name,age,email\nCarol,40,c@x.com"
        bad_lake = _FakeLakeRepo(raw=bad_csv)
        second_upload = await _record(seeded_db, source_id, bad_lake, filename="bad.csv")
        result = await process_upload(
            source_id=source_id,
            upload_id=second_upload,
            repositories={"lake_repository": lambda: bad_lake},
        )

        from app.use_cases.source.exceptions import SchemaMismatch

        match result:
            case Failure(error):
                assert isinstance(error, SchemaMismatch)
                assert "active" in error.missing
                assert "email" in error.extra
                # No append parquet write for the mismatched file.
                assert bad_lake.parquet_writes == []
            case Success(_):
                pytest.fail("mismatched subsequent upload should fail with SchemaMismatch")

    async def test_mismatched_upload_leaves_event_pending_for_idempotent_retry(self, seeded_db: AsyncSession):
        """A schema-mismatched upload is a Failure: the use-case transaction rolls
        back, so nothing is appended and the UploadRecorded event stays pending.
        Reprocessing the same upload replays the same SchemaMismatch (idempotent),
        and the user's recovery is to upload a NEW, corrected file."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)

        first_upload = await _record(seeded_db, source_id, lake)
        await process_upload(
            source_id=source_id,
            upload_id=first_upload,
            repositories={"lake_repository": lambda: lake},
        )

        bad_csv = b"name,age,email\nCarol,40,c@x.com"
        bad_lake = _FakeLakeRepo(raw=bad_csv)
        second_upload = await _record(seeded_db, source_id, bad_lake, filename="bad.csv")
        await process_upload(
            source_id=source_id,
            upload_id=second_upload,
            repositories={"lake_repository": lambda: bad_lake},
        )

        outbox = OutboxRepository(RestrictedSession(seeded_db))
        pending = await outbox.get_pending_event("upload", second_upload, "UploadRecorded")
        assert pending is not None, "mismatch rolls back the transaction — event stays pending"

    async def test_fails_when_no_pending_upload(self, seeded_db: AsyncSession):
        """process_upload fails if there is no pending UploadRecorded for (source, upload)."""
        set_session(seeded_db)
        lake = _FakeLakeRepo()
        source_id = await _make_source(seeded_db)

        result = await process_upload(
            source_id=source_id,
            upload_id="nonexistent-upload",
            repositories={"lake_repository": lambda: lake},
        )

        match result:
            case Failure(error):
                assert isinstance(error, UploadNotPending)
            case Success(_):
                pytest.fail("process_upload should fail when no pending upload exists")
