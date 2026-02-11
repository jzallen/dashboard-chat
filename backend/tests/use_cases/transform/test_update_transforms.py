import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.use_cases.transform import update_transforms
from app.repositories import set_session
from app.repositories.metadata import TransformRecord
from app.repositories.outbox.outbox_record import OutboxRecord


class TestUpdateTransforms:
    """Tests for update_transforms use case."""

    async def test_batch_update_succeeds(self, seeded_db: AsyncSession):
        """update_transforms should update transforms and return Success."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id="dataset-001",
            updates=[
                {"id": "transform-001", "name": "Renamed Filter"},
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"update_transforms should succeed, got: {error}")

    async def test_soft_delete_via_status(self, seeded_db: AsyncSession):
        """update_transforms with status='deleted' should soft-delete."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id="dataset-001",
            updates=[
                {"id": "transform-001", "status": "deleted"},
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"update_transforms should succeed, got: {error}")

        # Verify the transform status is now 'deleted'
        row = await seeded_db.execute(
            select(TransformRecord).where(TransformRecord.id == "transform-001")
        )
        transform = row.scalar_one()
        assert transform.status == "deleted"

    async def test_batch_toggle_multiple(self, seeded_db: AsyncSession):
        """update_transforms should toggle multiple transforms at once."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id="dataset-001",
            updates=[
                {"id": "transform-001", "status": "disabled"},
                {"id": "transform-002", "status": "disabled"},
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"update_transforms should succeed, got: {error}")

        # Verify both are disabled
        row1 = await seeded_db.execute(
            select(TransformRecord).where(TransformRecord.id == "transform-001")
        )
        assert row1.scalar_one().status == "disabled"

        row2 = await seeded_db.execute(
            select(TransformRecord).where(TransformRecord.id == "transform-002")
        )
        assert row2.scalar_one().status == "disabled"

    async def test_emits_outbox_event(self, seeded_db: AsyncSession):
        """update_transforms should write a TransformsUpdated outbox record."""
        set_session(seeded_db)

        await update_transforms(
            dataset_id="dataset-001",
            updates=[
                {"id": "transform-001", "status": "disabled"},
                {"id": "transform-002", "status": "deleted"},
            ],
        )

        result = await seeded_db.execute(
            select(OutboxRecord)
            .where(OutboxRecord.aggregate_type == "dataset")
            .where(OutboxRecord.aggregate_id == "dataset-001")
        )
        records = result.scalars().all()
        assert len(records) == 1
        assert records[0].event_type == "TransformsUpdated"
        assert records[0].payload["dataset_id"] == "dataset-001"
        assert len(records[0].payload["changes"]) == 2

    async def test_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """update_transforms should return Failure when dataset doesn't exist."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id="nonexistent",
            updates=[{"id": "transform-001", "status": "disabled"}],
        )

        match result:
            case Failure(error):
                assert "nonexistent" in error
            case Success():
                pytest.fail("Should fail for nonexistent dataset")
