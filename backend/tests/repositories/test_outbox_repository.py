"""Tests for OutboxRepository upload-listing query.

Port-to-port through the repository's public method against the in-memory
SQLite session. The UploadRecorded events are seeded via the repository's own
``submit_upload_recorded_event`` driving method, so the test exercises the real
write path; the read method under test then filters by the ``source_id`` carried
in each event's JSON payload (NOT the ``aggregate_id``, which is the upload_id).
"""

from app.repositories import RestrictedSession
from app.repositories.outbox import OutboxRepository
from tests.uuidv7_fixtures import PROJECT_1


async def _record(outbox, source_id: str, upload_id: str, filename: str) -> None:
    await outbox.submit_upload_recorded_event(
        source_id=source_id,
        project_id=PROJECT_1,
        upload_id=upload_id,
        storage_key=f"uploads/{PROJECT_1}/{filename}",
        original_filename=filename,
        file_size=100,
        content_type="text/csv",
    )


class TestListUploadsForSource:
    async def test_returns_only_uploads_for_the_given_source(self, db_session):
        outbox = OutboxRepository(RestrictedSession(db_session))
        await _record(outbox, "source-A", "upload-a1", "a1.csv")
        await _record(outbox, "source-A", "upload-a2", "a2.csv")
        await _record(outbox, "source-B", "upload-b1", "b1.csv")

        uploads = await outbox.list_uploads_for_source("source-A")

        filenames = {u.payload["original_filename"] for u in uploads}
        assert filenames == {"a1.csv", "a2.csv"}

    async def test_orders_by_created_at_ascending(self, db_session):
        outbox = OutboxRepository(RestrictedSession(db_session))
        await _record(outbox, "source-A", "upload-1", "first.csv")
        await _record(outbox, "source-A", "upload-2", "second.csv")
        await _record(outbox, "source-A", "upload-3", "third.csv")

        uploads = await outbox.list_uploads_for_source("source-A")

        order = [u.payload["original_filename"] for u in uploads]
        assert order == ["first.csv", "second.csv", "third.csv"]

    async def test_includes_both_processed_and_unprocessed_records(self, db_session):
        outbox = OutboxRepository(RestrictedSession(db_session))
        await _record(outbox, "source-A", "upload-done", "ingested.csv")
        await _record(outbox, "source-A", "upload-pending", "pending.csv")

        # Mark the first upload's event processed (as process_upload would).
        done = await outbox.get_pending_event("upload", "upload-done", "UploadRecorded")
        await outbox.mark_processed([done.id])

        uploads = await outbox.list_uploads_for_source("source-A")

        filenames = {u.payload["original_filename"] for u in uploads}
        assert filenames == {"ingested.csv", "pending.csv"}

    async def test_returns_empty_list_for_source_with_no_uploads(self, db_session):
        outbox = OutboxRepository(RestrictedSession(db_session))
        await _record(outbox, "source-A", "upload-a1", "a1.csv")

        assert await outbox.list_uploads_for_source("source-with-nothing") == []
