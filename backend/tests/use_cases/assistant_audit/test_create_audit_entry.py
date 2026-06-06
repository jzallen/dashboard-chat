"""Tests for the create_audit_entry use case (rich-catalog §2.7 Option A).

The driving port the agent POSTs to after executing a transform tool. It
verifies the requesting org owns the project, validates the audit ``tag``
against the ``AUDIT_TAGS`` vocabulary at the boundary, and inserts an
``assistant_audit_entries`` row from ``{node_id, node_kind, payload:{tool, say,
tag}}``, returning the created entry (including its server-generated ``id``) so
the caller can link the reversed FK (``transforms.assistant_audit_entry_id``).
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import AssistantAuditEntry
from app.use_cases.assistant_audit import create_audit_entry, list_audit_entries_for_project
from app.use_cases.dataset import create_transforms
from tests.uuidv7_fixtures import (
    DATASET_1,
    ORG_1,
    PROJECT_1,
    PROJECT_OTHER,
)


class TestCreateAuditEntry:
    async def test_inserts_record_and_returns_it_with_id(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await create_audit_entry(
            PROJECT_1,
            node_id=DATASET_1,
            node_kind="dataset",
            payload={"tool": "trimWhitespace", "say": "Trimmed whitespace on email", "tag": "clean"},
            org_id=ORG_1,
        )

        match result:
            case Success(record):
                assert record["id"]  # server-generated uuidv7
                assert record["node_id"] == DATASET_1
                assert record["node_kind"] == "dataset"
                assert record["payload"]["tool"] == "trimWhitespace"
                assert record["payload"]["say"] == "Trimmed whitespace on email"
                assert record["payload"]["tag"] == "clean"
            case Failure(error):
                pytest.fail(f"expected success, got {error}")

        rows = (await seeded_db.execute(select(AssistantAuditEntry))).scalars().all()
        assert len(rows) == 1
        assert rows[0].org_id == ORG_1
        assert rows[0].project_id == PROJECT_1

    async def test_fails_when_project_owned_by_another_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await create_audit_entry(
            PROJECT_OTHER,
            node_id=DATASET_1,
            node_kind="dataset",
            payload={"tool": "trimWhitespace", "say": "x", "tag": "clean"},
            org_id=ORG_1,
        )

        match result:
            case Failure(_):
                pass
            case Success(_):
                pytest.fail("expected failure for cross-org project access")

        rows = (await seeded_db.execute(select(AssistantAuditEntry))).scalars().all()
        assert rows == []

    async def test_created_entry_then_linked_transform_surface_via_list(self, seeded_db: AsyncSession):
        """The reversed FK works end to end: create an entry, create a transform
        pointing at it, then the audit list surfaces transform_id + enabled."""
        set_session(seeded_db)

        created = (
            await create_audit_entry(
                PROJECT_1,
                node_id=DATASET_1,
                node_kind="dataset",
                payload={"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
                org_id=ORG_1,
            )
        ).unwrap()
        assistant_audit_entry_id = created["id"]

        await create_transforms(
            dataset_id=DATASET_1,
            transforms_input=[
                {
                    "name": "trim email",
                    "condition_json": {"id": "root", "type": "group", "children1": []},
                    "condition_sql": "col1 = 'x'",
                    "assistant_audit_entry_id": assistant_audit_entry_id,
                },
            ],
        )

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert len(rows) == 1
        assert rows[0]["id"] == assistant_audit_entry_id
        assert rows[0]["transform_id"] is not None
        assert rows[0]["enabled"] is True

    async def test_fails_when_tag_not_in_vocabulary(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await create_audit_entry(
            PROJECT_1,
            node_id=DATASET_1,
            node_kind="dataset",
            payload={"tool": "trimWhitespace", "say": "x", "tag": "not-a-real-tag"},
            org_id=ORG_1,
        )

        match result:
            case Failure(_):
                pass
            case Success(_):
                pytest.fail("expected failure for invalid audit tag")

        rows = (await seeded_db.execute(select(AssistantAuditEntry))).scalars().all()
        assert rows == []
