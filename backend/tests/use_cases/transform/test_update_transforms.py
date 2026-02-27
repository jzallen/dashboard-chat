import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import TransformRecord
from app.repositories.outbox.outbox_record import OutboxRecord
from app.use_cases.transform import update_transforms
from tests.uuidv7_fixtures import DATASET_1, TRANSFORM_1, TRANSFORM_2


class TestUpdateTransforms:
    """Tests for update_transforms use case."""

    async def test_batch_update_succeeds(self, seeded_db: AsyncSession):
        """update_transforms should update transforms and return Success."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id=DATASET_1,
            updates=[
                {"id": TRANSFORM_1, "name": "Renamed Filter"},
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
            dataset_id=DATASET_1,
            updates=[
                {"id": TRANSFORM_1, "status": "deleted"},
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"update_transforms should succeed, got: {error}")

        # Verify the transform status is now 'deleted'
        row = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        transform = row.scalar_one()
        assert transform.status == "deleted"

    async def test_batch_toggle_multiple(self, seeded_db: AsyncSession):
        """update_transforms should toggle multiple transforms at once."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id=DATASET_1,
            updates=[
                {"id": TRANSFORM_1, "status": "disabled"},
                {"id": TRANSFORM_2, "status": "disabled"},
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"update_transforms should succeed, got: {error}")

        # Verify both are disabled
        row1 = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        assert row1.scalar_one().status == "disabled"

        row2 = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_2))
        assert row2.scalar_one().status == "disabled"

    async def test_emits_outbox_event(self, seeded_db: AsyncSession):
        """update_transforms should write a TransformsUpdated outbox record."""
        set_session(seeded_db)

        await update_transforms(
            dataset_id=DATASET_1,
            updates=[
                {"id": TRANSFORM_1, "status": "disabled"},
                {"id": TRANSFORM_2, "status": "deleted"},
            ],
        )

        result = await seeded_db.execute(
            select(OutboxRecord)
            .where(OutboxRecord.aggregate_type == "dataset")
            .where(OutboxRecord.aggregate_id == DATASET_1)
        )
        records = result.scalars().all()
        assert len(records) == 1
        record = records[0]
        assert record.event_type == "TransformsUpdated"
        assert record.payload == {
            "dataset_id": DATASET_1,
            "changes": record.payload["changes"],
        }
        assert len(record.payload["changes"]) == 2

    async def test_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
        """update_transforms should return Failure when dataset doesn't exist."""
        set_session(seeded_db)

        result = await update_transforms(
            dataset_id="nonexistent",
            updates=[{"id": TRANSFORM_1, "status": "disabled"}],
        )

        match result:
            case Failure(error):
                assert "nonexistent" in str(error)
            case Success():
                pytest.fail("Should fail for nonexistent dataset")
