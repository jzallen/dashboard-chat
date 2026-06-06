"""Tests for the list_audit_entries_for_project use case (rich-catalog §2.11).

The use case is the driving port for the audit read. It returns the project's
``assistant_audit_entries`` LEFT-JOINed to ``transforms`` on the reversed FK
(``transforms.assistant_audit_entry_id``), projecting each row to the audit shape
the UI needs: ``node_id``/``node_kind`` + ``tool``/``say``/``tag`` (from the JSON
payload) + ``transform_id``/``enabled`` (from the join — present iff a Transform
points UP at the entry). Org-scoped + project-ownership-checked.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import AssistantAuditEntry, TransformRecord
from app.use_cases.assistant_audit import list_audit_entries_for_project
from tests.uuidv7_fixtures import (
    AUDIT_ENTRY_1,
    AUDIT_ENTRY_2,
    AUDIT_ENTRY_3,
    DATASET_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_OTHER,
    TRANSFORM_1,
    USER_1,
)

USER = AuthUser(id=USER_1, email="dev@example.com", org_id=ORG_1, name="Dev")


def _entry(id, *, node_id, sequence, payload, org_id=ORG_1, project_id=PROJECT_1, node_kind="dataset"):
    return AssistantAuditEntry(
        id=id,
        org_id=org_id,
        project_id=project_id,
        node_id=node_id,
        node_kind=node_kind,
        payload=payload,
        sequence=sequence,
    )


class TestListAuditEntriesForProject:
    async def test_returns_empty_when_no_records(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)

        match result:
            case Success(rows):
                assert rows == []
            case Failure(error):
                pytest.fail(f"expected empty list, got {error}")

    async def test_projects_payload_fields_to_audit_shape(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(
            _entry(
                AUDIT_ENTRY_1,
                node_id=DATASET_1,
                sequence=0,
                payload={"tool": "trimWhitespace", "say": "Trimmed whitespace on email", "tag": "clean"},
            )
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert len(rows) == 1
        assert rows[0]["node_id"] == DATASET_1
        assert rows[0]["node_kind"] == "dataset"
        assert rows[0]["tool"] == "trimWhitespace"
        assert rows[0]["say"] == "Trimmed whitespace on email"
        assert rows[0]["tag"] == "clean"

    async def test_log_only_entry_has_null_transform_id_and_enabled(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(
            _entry(
                AUDIT_ENTRY_1,
                node_id=DATASET_1,
                sequence=0,
                payload={"tool": "createView", "say": "Created a view", "tag": "create"},
            )
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert rows[0]["transform_id"] is None
        assert rows[0]["enabled"] is None

    async def test_left_join_surfaces_transform_id_and_enabled_when_transform_points_at_entry(
        self, seeded_db: AsyncSession
    ):
        set_session(seeded_db)
        seeded_db.add(
            _entry(
                AUDIT_ENTRY_1,
                node_id=DATASET_1,
                sequence=0,
                payload={"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
            )
        )
        seeded_db.add(
            TransformRecord(
                id=TRANSFORM_1,
                dataset_id=DATASET_1,
                name="trim email",
                condition_json={},
                status="enabled",
                assistant_audit_entry_id=AUDIT_ENTRY_1,
            )
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert rows[0]["transform_id"] == TRANSFORM_1
        assert rows[0]["enabled"] is True

    async def test_enabled_is_false_when_pointing_transform_disabled(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(
            _entry(
                AUDIT_ENTRY_1,
                node_id=DATASET_1,
                sequence=0,
                payload={"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
            )
        )
        seeded_db.add(
            TransformRecord(
                id=TRANSFORM_1,
                dataset_id=DATASET_1,
                name="trim email",
                condition_json={},
                status="disabled",
                assistant_audit_entry_id=AUDIT_ENTRY_1,
            )
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert rows[0]["transform_id"] == TRANSFORM_1
        assert rows[0]["enabled"] is False

    async def test_ordered_by_node_id_then_sequence(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # Same node, out-of-order sequence; expect sequence ordering within node.
        seeded_db.add(
            _entry(AUDIT_ENTRY_2, node_id=DATASET_1, sequence=2, payload={"tool": "b", "say": "second", "tag": "fix"})
        )
        seeded_db.add(
            _entry(AUDIT_ENTRY_1, node_id=DATASET_1, sequence=1, payload={"tool": "a", "say": "first", "tag": "clean"})
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert [r["say"] for r in rows] == ["first", "second"]

    async def test_org_scoping_excludes_records_from_other_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # An entry on PROJECT_OTHER (ORG_OTHER) must never surface for ORG_1.
        seeded_db.add(
            _entry(
                AUDIT_ENTRY_3,
                node_id="some-node",
                sequence=0,
                payload={"tool": "x", "say": "other org", "tag": "clean"},
                org_id=ORG_OTHER,
                project_id=PROJECT_OTHER,
            )
        )
        await seeded_db.commit()

        rows = (await list_audit_entries_for_project(PROJECT_1, org_id=ORG_1)).unwrap()

        assert rows == []

    async def test_fails_for_nonexistent_project(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await list_audit_entries_for_project("nonexistent", org_id=ORG_1)

        match result:
            case Failure(_):
                pass
            case Success(_):
                pytest.fail("expected failure for nonexistent project")

    async def test_fails_when_project_owned_by_another_org(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # PROJECT_OTHER belongs to ORG_OTHER; ORG_1 may not read it.
        result = await list_audit_entries_for_project(PROJECT_OTHER, org_id=ORG_1)

        match result:
            case Failure(_):
                pass
            case Success(_):
                pytest.fail("expected failure for cross-org project access")
