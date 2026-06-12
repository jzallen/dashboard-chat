"""Tests for the list_source_uploads use case.

Port-to-port: enters through the use-case driving port and asserts on the
returned list of upload dicts. UploadRecorded events are seeded via the outbox
repository's own write method; the use case reads them back, mapping each
event's payload + record metadata into the UI-facing dict shape.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import RestrictedSession, set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.repositories.outbox import OutboxRepository
from app.use_cases.source import list_source_uploads
from app.use_cases.source.exceptions import SourceNotFound
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.commit()
    return db_session


async def _make_source(name: str = "Patients") -> str:
    from app.use_cases.source import create_source

    return (await create_source(project_id=PROJECT_1, name=name, user=TEST_USER)).unwrap()["id"]


async def _record(db_session, source_id: str, upload_id: str, filename: str) -> None:
    outbox = OutboxRepository(RestrictedSession(db_session))
    await outbox.submit_upload_recorded_event(
        source_id=source_id,
        project_id=PROJECT_1,
        upload_id=upload_id,
        storage_key=f"uploads/{PROJECT_1}/{filename}",
        original_filename=filename,
        file_size=2048,
        content_type="text/csv",
    )
    await db_session.commit()


class TestListSourceUploads:
    async def test_maps_payload_fields_to_upload_dicts(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        source_id = await _make_source()
        await _record(seeded_db, source_id, "upload-1", "patients.csv")

        result = await list_source_uploads(source_id=source_id)

        match result:
            case Success(uploads):
                assert len(uploads) == 1
                upload = uploads[0]
                assert upload["upload_id"] == "upload-1"
                assert upload["original_filename"] == "patients.csv"
                assert upload["file_size"] == 2048
                assert isinstance(upload["created_at"], str)
            case Failure(error):
                pytest.fail(f"should succeed, got: {error}")

    async def test_status_is_pending_for_unprocessed_and_row_count_absent(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        source_id = await _make_source()
        await _record(seeded_db, source_id, "upload-1", "pending.csv")

        uploads = (await list_source_uploads(source_id=source_id)).unwrap()

        assert uploads[0]["status"] == "pending"
        assert uploads[0]["row_count"] is None

    async def test_status_is_ingested_with_row_count_for_processed(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        source_id = await _make_source()
        await _record(seeded_db, source_id, "upload-1", "ingested.csv")

        outbox = OutboxRepository(RestrictedSession(seeded_db))
        rec = await outbox.get_pending_event("upload", "upload-1", "UploadRecorded")
        await outbox.update_payload(rec.id, {"row_count": 42})
        await outbox.mark_processed([rec.id])
        await seeded_db.commit()

        uploads = (await list_source_uploads(source_id=source_id)).unwrap()

        assert uploads[0]["status"] == "ingested"
        assert uploads[0]["row_count"] == 42

    async def test_returns_only_this_sources_uploads(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        source_a = await _make_source("A")
        source_b = await _make_source("B")
        await _record(seeded_db, source_a, "upload-a", "a.csv")
        await _record(seeded_db, source_b, "upload-b", "b.csv")

        uploads = (await list_source_uploads(source_id=source_a)).unwrap()

        assert [u["original_filename"] for u in uploads] == ["a.csv"]

    async def test_fails_when_source_not_found(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await list_source_uploads(source_id="nonexistent-source")

        match result:
            case Failure(error):
                assert isinstance(error, SourceNotFound)
            case Success(_):
                pytest.fail("should fail when the source does not exist")
