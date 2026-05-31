"""MR-7 — archive_dataset use case (move a source to cold storage).

Driving port: the ``archive_dataset`` use case (the same port
``POST /api/datasets/{id}/archive`` wires) invoked with ``set_session(seeded_db)`` +
``set_auth_user`` (autouse conftest fixtures). Archiving sets ``archived_at = now`` and
``retention_until = archived_at + 90 days`` via the existing generic update path; the
underlying ``name``/``display_name`` are left untouched. RED until DELIVER 07-01.
"""

from datetime import datetime, timedelta

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.dataset import archive_dataset
from tests.uuidv7_fixtures import DATASET_1

RETENTION_DAYS = 90


class TestArchiveDataset:
    """Tests for the archive_dataset use case."""

    async def test_archive_sets_archived_at_and_90_day_retention(self, seeded_db: AsyncSession):
        """Archiving a live source stamps archived_at and a retention_until 90 days later."""
        set_session(seeded_db)

        result = await archive_dataset(dataset_id=DATASET_1)

        match result:
            case Success(dataset):
                assert dataset.archived_at is not None, "archived_at must be set on archive"
                assert dataset.retention_until is not None, "retention_until must be set on archive"
                archived_at = datetime.fromisoformat(dataset.archived_at)
                retention_until = datetime.fromisoformat(dataset.retention_until)
                assert retention_until - archived_at == timedelta(days=RETENTION_DAYS)
                # The underlying source name is never mutated by archiving.
                assert dataset.name == "Dataset One"
            case Failure(error):
                pytest.fail(f"archive_dataset should succeed, got: {error}")

    async def test_archive_when_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """Archiving a non-existent dataset returns Failure(DatasetNotFound)."""
        set_session(seeded_db)

        result = await archive_dataset(dataset_id="nonexistent")

        match result:
            case Failure(error):
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("archive_dataset should fail when dataset does not exist")

    async def test_archive_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """archive_dataset returns Failure when a database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def dataset_exists(self, dataset_id: str) -> bool:
                raise SQLAlchemyError("Database connection lost")

        result = await archive_dataset(
            dataset_id=DATASET_1,
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert str(error) == "Database connection lost"
            case Success(_):
                pytest.fail("archive_dataset should fail when database error occurs")
