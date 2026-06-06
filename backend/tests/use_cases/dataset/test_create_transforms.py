import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import AssistantAuditEntry, TransformRecord
from app.repositories.outbox.outbox_record import OutboxRecord
from app.use_cases.dataset import create_transforms
from tests.uuidv7_fixtures import AUDIT_ENTRY_1, DATASET_1, ORG_1, PROJECT_1


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

    async def test_create_transforms_sets_audit_entry_id_when_provided(self, seeded_db: AsyncSession):
        """create_transforms threads an optional assistant_audit_entry_id onto the new transform (reversed FK)."""
        set_session(seeded_db)
        seeded_db.add(
            AssistantAuditEntry(
                id=AUDIT_ENTRY_1,
                org_id=ORG_1,
                project_id=PROJECT_1,
                node_id=DATASET_1,
                node_kind="dataset",
                payload={"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
                sequence=0,
            )
        )
        await seeded_db.commit()

        await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "Linked Filter",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'x'",
                    "assistant_audit_entry_id": AUDIT_ENTRY_1,
                },
            ],
        )

        rows = (
            (await seeded_db.execute(select(TransformRecord).where(TransformRecord.name == "Linked Filter")))
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].assistant_audit_entry_id == AUDIT_ENTRY_1

    async def test_create_transforms_leaves_audit_entry_id_null_when_omitted(self, seeded_db: AsyncSession):
        """Existing callers that omit assistant_audit_entry_id are unaffected (column stays null)."""
        set_session(seeded_db)

        await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "Unlinked Filter",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'y'",
                },
            ],
        )

        rows = (
            (await seeded_db.execute(select(TransformRecord).where(TransformRecord.name == "Unlinked Filter")))
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].assistant_audit_entry_id is None

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
