import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.use_cases.transform import create_transforms
from app.repositories import set_session
from app.repositories.outbox.outbox_record import OutboxRecord


class TestCreateTransforms:
    """Tests for create_transforms use case."""

    async def test_batch_create_succeeds(self, seeded_db: AsyncSession):
        """create_transforms should create transforms and return Success."""
        set_session(seeded_db)

        result = await create_transforms(
            dataset_id="dataset-001",
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

    async def test_batch_create_multiple(self, seeded_db: AsyncSession):
        """create_transforms should handle multiple transforms at once."""
        set_session(seeded_db)

        result = await create_transforms(
            dataset_id="dataset-001",
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

    async def test_emits_outbox_event(self, seeded_db: AsyncSession):
        """create_transforms should write a TransformsCreated outbox record."""
        set_session(seeded_db)

        await create_transforms(
            dataset_id="dataset-001",
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
            .where(OutboxRecord.aggregate_id == "dataset-001")
        )
        records = result.scalars().all()
        assert len(records) == 1
        assert records[0].event_type == "TransformsCreated"
        assert records[0].payload["dataset_id"] == "dataset-001"
        assert len(records[0].payload["transforms"]) == 1
        assert records[0].payload["transforms"][0]["name"] == "Outbox Test"

    async def test_dataset_not_found_returns_failure(self, seeded_db: AsyncSession):
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
                assert "nonexistent" in error
            case Success():
                pytest.fail("Should fail for nonexistent dataset")
