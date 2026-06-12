"""Tests for the record_upload use case (slice 2).

Port-to-port: enters through the use-case driving port, asserts on the
returned ``{upload_id, put_url, storage_key, status}`` and the emitted
``UploadRecorded`` pending event at the outbox driven-port boundary.

The defining contract of this slice: record_upload mints a presigned PUT URL
and writes NO bytes — the browser uploads directly to MinIO. The lake repo is
a port double here; we assert ``write_raw_file`` is never called.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import RestrictedSession, set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.repositories.outbox import OutboxRepository
from app.use_cases.source import record_upload
from app.use_cases.source.exceptions import SourceNotFound
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


class _FakeLakeRepo:
    """Lake port double recording calls. Mints a deterministic presigned URL
    and asserts (by recording) that no raw bytes are ever written."""

    def __init__(self):
        self.write_raw_file_calls: list = []
        self.presign_calls: list = []

    def presigned_put_url(self, storage_key: str, content_type: str, expires_in: int) -> str:
        self.presign_calls.append((storage_key, content_type, expires_in))
        return f"http://minio.public/dashboard-chat.datalake/{storage_key}?X-Amz-Signature=abc"

    def write_raw_file(self, content: bytes, storage_path: str) -> str:  # pragma: no cover - must not be called
        self.write_raw_file_calls.append((content, storage_path))
        return f"s3://bucket/{storage_path}"


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed ORG_1 + PROJECT_1 (the FK + authorization prerequisite)."""
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.commit()
    return db_session


async def _make_source(db_session: AsyncSession, name: str = "Patients") -> str:
    from app.use_cases.source import create_source

    result = await create_source(project_id=PROJECT_1, name=name, user=TEST_USER)
    return result.unwrap()["id"]


class TestRecordUpload:
    async def test_returns_put_url_and_storage_key_with_pending_status(self, seeded_db: AsyncSession):
        """record_upload returns the presigned PUT URL, storage key, upload id, and pending status."""
        set_session(seeded_db)
        source_id = await _make_source(seeded_db)
        fake_lake = _FakeLakeRepo()

        result = await record_upload(
            source_id=source_id,
            filename="patients.csv",
            content_type="text/csv",
            file_size=2048,
            user=TEST_USER,
            repositories={"lake_repository": lambda: fake_lake},
        )

        match result:
            case Success(data):
                assert data["status"] == "pending"
                assert data["put_url"].startswith("http://minio.public/")
                assert "id" in data["upload_id"] or data["upload_id"]
                expected_key = f"uploads/{PROJECT_1}/{source_id}/{data['upload_id']}/patients.csv"
                assert data["storage_key"] == expected_key
                # The presigned URL was minted for that exact key + content type.
                assert fake_lake.presign_calls[0][0] == expected_key
                assert fake_lake.presign_calls[0][1] == "text/csv"
            case Failure(error):
                pytest.fail(f"record_upload should succeed, got: {error}")

    async def test_writes_no_bytes(self, seeded_db: AsyncSession):
        """record_upload mints a URL only — it must NOT write any bytes to the lake."""
        set_session(seeded_db)
        source_id = await _make_source(seeded_db)
        fake_lake = _FakeLakeRepo()

        await record_upload(
            source_id=source_id,
            filename="patients.csv",
            content_type="text/csv",
            file_size=2048,
            user=TEST_USER,
            repositories={"lake_repository": lambda: fake_lake},
        )

        assert fake_lake.write_raw_file_calls == []

    async def test_emits_upload_recorded_pending_event(self, seeded_db: AsyncSession):
        """record_upload emits a pending UploadRecorded event for (source_id, upload_id)."""
        set_session(seeded_db)
        source_id = await _make_source(seeded_db)
        fake_lake = _FakeLakeRepo()

        result = await record_upload(
            source_id=source_id,
            filename="patients.csv",
            content_type="text/csv",
            file_size=2048,
            user=TEST_USER,
            repositories={"lake_repository": lambda: fake_lake},
        )
        upload_id = result.unwrap()["upload_id"]

        outbox = OutboxRepository(RestrictedSession(seeded_db))
        pending = await outbox.get_pending_event("upload", upload_id, "UploadRecorded")
        assert pending is not None
        assert pending.payload["source_id"] == source_id
        assert pending.payload["project_id"] == PROJECT_1
        assert pending.payload["upload_id"] == upload_id
        assert pending.payload["original_filename"] == "patients.csv"
        assert pending.payload["file_size"] == 2048
        assert pending.payload["content_type"] == "text/csv"
        assert pending.payload["status"] == "pending"

    async def test_fails_when_source_not_found(self, seeded_db: AsyncSession):
        """record_upload returns Failure(SourceNotFound) for an unknown source."""
        set_session(seeded_db)
        fake_lake = _FakeLakeRepo()

        result = await record_upload(
            source_id="019515a0-00ff-7000-8000-0000000000ff",
            filename="patients.csv",
            content_type="text/csv",
            file_size=2048,
            user=TEST_USER,
            repositories={"lake_repository": lambda: fake_lake},
        )

        match result:
            case Failure(error):
                assert isinstance(error, SourceNotFound)
            case Success(_):
                pytest.fail("record_upload should fail for a nonexistent source")
