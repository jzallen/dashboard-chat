"""MR-7 — restore_dataset use case (bring a source back from cold storage).

Driving port: the ``restore_dataset`` use case (the same port
``POST /api/datasets/{id}/restore`` wires) invoked with ``set_session(seeded_db)`` +
``set_auth_user`` (autouse conftest fixtures). Restoring clears ``archived_at`` and
``retention_until`` (both ``None``). RED until DELIVER 07-01.
"""

from datetime import UTC, datetime, timedelta

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import DatasetRecord
from app.use_cases.dataset import restore_dataset
from tests.uuidv7_fixtures import DATASET_1


async def _archive_directly(db: AsyncSession, dataset_id: str) -> None:
    """Stamp a dataset as archived directly on the ORM record (test setup)."""
    record = (await db.execute(select(DatasetRecord).where(DatasetRecord.id == dataset_id))).scalar_one()
    now = datetime.now(UTC)
    record.archived_at = now
    record.retention_until = now + timedelta(days=90)
    await db.commit()


class TestRestoreDataset:
    """Tests for the restore_dataset use case."""

    async def test_restore_clears_archived_at_and_retention_until(self, seeded_db: AsyncSession):
        """Restoring an archived source clears both cold-storage timestamps."""
        set_session(seeded_db)
        await _archive_directly(seeded_db, DATASET_1)

        result = await restore_dataset(dataset_id=DATASET_1)

        match result:
            case Success(dataset):
                assert dataset.archived_at is None, "archived_at must be cleared on restore"
                assert dataset.retention_until is None, "retention_until must be cleared on restore"
                assert dataset.name == "Dataset One"
            case Failure(error):
                pytest.fail(f"restore_dataset should succeed, got: {error}")

    async def test_restore_when_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """Restoring a non-existent dataset returns Failure(DatasetNotFound)."""
        set_session(seeded_db)

        result = await restore_dataset(dataset_id="nonexistent")

        match result:
            case Failure(error):
                assert str(error) == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("restore_dataset should fail when dataset does not exist")
