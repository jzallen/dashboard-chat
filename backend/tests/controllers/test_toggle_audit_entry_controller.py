"""Tests for the AssistantAuditController toggle endpoint (rich-catalog §2.6).

Exercises the controller through the REAL use case + DB (port-to-port): seed an
entry + a pointing transform, toggle it, and assert the controller flips the
transform status and emits the entry as a JSON:API single (type:"audit-entries")
reflecting the toggled node.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.repositories import set_session
from app.repositories.metadata import (
    AssistantAuditEntry,
    DatasetRecord,
    ProjectRecord,
    TransformRecord,
)
from tests.uuidv7_fixtures import (
    AUDIT_ENTRY_1,
    AUDIT_ENTRY_2,
    DATASET_1,
    ORG_1,
    PROJECT_1,
    TRANSFORM_1,
)


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    set_session(db_session)
    db_session.add(ProjectRecord(id=PROJECT_1, name="P", org_id=ORG_1))
    db_session.add(DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="D", schema_config={"fields": {}}))
    db_session.add(
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
    db_session.add(
        TransformRecord(
            id=TRANSFORM_1,
            dataset_id=DATASET_1,
            name="trim",
            condition_json={},
            status="enabled",
            assistant_audit_entry_id=AUDIT_ENTRY_1,
        )
    )
    await db_session.commit()
    return db_session


class TestToggleAuditEntryController:
    async def test_disabling_returns_entry_and_flips_transform(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        body, status = await HTTPController.toggle_audit_entry(AUDIT_ENTRY_1, enabled=False, org_id=ORG_1)

        assert status == 200
        item = body["data"]
        assert item["type"] == "audit-entries"
        assert item["id"] == AUDIT_ENTRY_1
        assert item["attributes"]["node_id"] == DATASET_1

        row = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        assert row.scalar_one().status == "disabled"

    async def test_log_only_entry_returns_409(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(
            AssistantAuditEntry(
                id=AUDIT_ENTRY_2,
                org_id=ORG_1,
                project_id=PROJECT_1,
                node_id=DATASET_1,
                node_kind="dataset",
                payload={"tool": "createView", "say": "x", "tag": "create"},
                sequence=1,
            )
        )
        await seeded_db.commit()

        _body, status = await HTTPController.toggle_audit_entry(AUDIT_ENTRY_2, enabled=False, org_id=ORG_1)

        assert status == 409

    async def test_cross_org_toggle_is_not_found(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        _body, status = await HTTPController.toggle_audit_entry(AUDIT_ENTRY_1, enabled=False, org_id="other-org")

        assert status == 404
