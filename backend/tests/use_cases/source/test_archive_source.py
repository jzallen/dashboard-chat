"""Tests for the archive_source use case (move a source to Cold Storage).

Port-to-port: enters through the ``archive_source`` driving port with
``set_session(seeded_db)`` and asserts on the returned source dict (the source
path returns dicts, not domain objects — mirrors ``get_source``). Archiving
stamps ``archived_at = now`` and ``retention_until = archived_at + 90 days`` via
the generic ``update_source`` path; re-archiving is idempotent and preserves the
original ``archived_at`` (the retention clock is not advanced). The child Dataset
linked to the source is never touched.
"""

import pytest
from freezegun import freeze_time
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import (
    DatasetRecord,
    OrganizationRecord,
    ProjectRecord,
    SourceRecord,
)
from app.use_cases.source import archive_source
from app.use_cases.source.exceptions import SourceNotFound
from tests.uuidv7_fixtures import DATASET_1, ORG_1, PROJECT_1, SOURCE_1


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed ORG_1 + PROJECT_1 + an active SOURCE_1 with a linked child Dataset."""
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    db_session.add(
        SourceRecord(
            id=SOURCE_1,
            project_id=PROJECT_1,
            name="Patients",
            schema_config={"fields": {"patient_id": {"type": "text"}}},
        )
    )
    db_session.add(
        DatasetRecord(
            id=DATASET_1,
            project_id=PROJECT_1,
            name="Patients View",
            schema_config={"fields": {"patient_id": {"type": "text"}}},
            source_id=SOURCE_1,
        )
    )
    await db_session.commit()
    return db_session


class TestArchiveSource:
    """The archive_source use case (PATCH -> Cold Storage)."""

    async def test_archive_sets_archived_at_and_90_day_retention(self, seeded_db: AsyncSession):
        """Archiving an active source stamps archived_at now and retention_until 90 days later."""
        set_session(seeded_db)

        with freeze_time("2026-07-22T12:00:00+00:00"):
            result = await archive_source(source_id=SOURCE_1, archived=True)

        match result:
            case Success(source):
                assert (source["archived_at"], source["retention_until"]) == (
                    "2026-07-22T12:00:00",
                    "2026-10-20T12:00:00",
                )
            case Failure(error):
                pytest.fail(f"archive_source should succeed, got: {error}")

    async def test_re_archive_preserves_original_archived_at(self, seeded_db: AsyncSession):
        """Re-archiving an already-archived source is a no-op — the retention clock is not advanced."""
        set_session(seeded_db)

        with freeze_time("2026-07-22T12:00:00+00:00"):
            first = (await archive_source(source_id=SOURCE_1, archived=True)).unwrap()
        with freeze_time("2026-08-30T09:00:00+00:00"):
            second = (await archive_source(source_id=SOURCE_1, archived=True)).unwrap()

        assert second == first

    async def test_archive_leaves_child_datasets_untouched(self, seeded_db: AsyncSession):
        """Archiving a source does not cascade to the Dataset built from it."""
        set_session(seeded_db)

        await archive_source(source_id=SOURCE_1, archived=True)

        dataset = await seeded_db.get(DatasetRecord, DATASET_1)
        await seeded_db.refresh(dataset)
        assert dataset.archived_at is None, "child dataset must not be archived by a source archive"
        assert dataset.retention_until is None

    async def test_archive_unknown_source_returns_source_not_found(self, seeded_db: AsyncSession):
        """Archiving a non-existent source returns Failure(SourceNotFound)."""
        set_session(seeded_db)

        result = await archive_source(source_id="019515a0-b0ff-7000-8000-0000000000ff", archived=True)

        match result:
            case Failure(error):
                assert isinstance(error, SourceNotFound)
            case Success(_):
                pytest.fail("archive_source should fail when the source does not exist")

    async def test_archive_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """archive_source returns Failure when the repository read raises."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def get_source(self, source_id: str) -> dict:
                raise SQLAlchemyError("Database connection lost")

            async def source_exists(self, source_id: str) -> bool:
                raise SQLAlchemyError("Database connection lost")

        result = await archive_source(
            source_id=SOURCE_1,
            archived=True,
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Database connection lost"
            case Success(_):
                pytest.fail("archive_source should fail when a database error occurs")


class TestRestoreSource:
    """Restore is the same port with ``archived=False`` — it clears Cold Storage."""

    async def test_restore_clears_archived_at_and_retention(self, seeded_db: AsyncSession):
        """Restoring an archived source clears both archived_at and retention_until."""
        set_session(seeded_db)

        with freeze_time("2026-07-22T12:00:00+00:00"):
            await archive_source(source_id=SOURCE_1, archived=True)

        result = await archive_source(source_id=SOURCE_1, archived=False)

        match result:
            case Success(source):
                assert (source["archived_at"], source["retention_until"]) == (None, None)
            case Failure(error):
                pytest.fail(f"restore should succeed, got: {error}")

    async def test_restore_when_already_active_is_idempotent(self, seeded_db: AsyncSession):
        """Restoring a source that was never archived is a no-op — fields stay null."""
        set_session(seeded_db)

        result = await archive_source(source_id=SOURCE_1, archived=False)

        match result:
            case Success(source):
                assert (source["archived_at"], source["retention_until"]) == (None, None)
            case Failure(error):
                pytest.fail(f"restore of an active source should succeed, got: {error}")
