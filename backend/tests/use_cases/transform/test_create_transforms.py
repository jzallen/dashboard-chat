import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.outbox.outbox_record import OutboxRecord
from app.use_cases.transform import create_transforms
from tests.uuidv7_fixtures import DATASET_1


class TestCreateTransforms:
    """Tests for create_transforms use case."""

    async def test_create_transforms_when_valid_input_returns_success(self, seeded_db: AsyncSession):
        """create_transforms should create transforms and return Success."""
        set_session(seeded_db)

        result = await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "New Filter",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'new'",
                    "description": "A new filter",
                },
            ],
        )

        match result:
            case Success():
                pass  # Expected
            case Failure(error):
                pytest.fail(f"create_transforms should succeed, got: {error}")

    async def test_create_transforms_when_multiple_transforms_returns_success(self, seeded_db: AsyncSession):
        """create_transforms should handle multiple transforms at once."""
        set_session(seeded_db)

        result = await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "Filter A",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'a'",
                },
                {
                    "name": "Filter B",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'b'",
                },
            ],
        )

        match result:
            case Success():
                pass
            case Failure(error):
                pytest.fail(f"create_transforms should succeed, got: {error}")

    async def test_create_transforms_when_successful_emits_outbox_event(self, seeded_db: AsyncSession):
        """create_transforms should write a TransformsCreated outbox record."""
        set_session(seeded_db)

        await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "Outbox Test",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'test'",
                },
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
        assert record.event_type == "TransformsCreated"
        assert record.payload == {
            "dataset_id": DATASET_1,
            "transforms": [
                {
                    **record.payload["transforms"][0],
                    "name": "Outbox Test",
                },
            ],
        }

    async def test_create_transforms_when_dataset_missing_returns_failure(self, seeded_db: AsyncSession):
        """create_transforms should return Failure when dataset doesn't exist."""
        set_session(seeded_db)

        result = await create_transforms(
            dataset_id="nonexistent",
            transforms_input=[
                {
                    "name": "Fail",
                    "condition_json": {},
                    "condition_sql": "",
                },
            ],
        )

        match result:
            case Failure(error):
                assert "nonexistent" in str(error)
            case Success():
                pytest.fail("Should fail for nonexistent dataset")
