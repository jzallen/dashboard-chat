"""Tests for the toggle_audit_entry use case (rich-catalog §2.5-2.6).

The driving port for the FIRST audit/transform WRITE. Toggling a transform-type
audit entry enables/disables the ``Transform`` that points UP at it (via the
reversed FK ``transforms.assistant_audit_entry_id``), which recompiles the
dataset's staging SQL on read (only ENABLED transforms participate). The use case
resolves the transform via the reverse FK, sets its status, and returns the entry
(incl. ``node_id``) so the controller/UI knows which node's audit to revalidate.

Org-scoped + project-ownership: an entry from another org is invisible. An entry
with no transform pointing at it (log-only) is not toggleable.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.repositories import set_session
from app.repositories.metadata import (
    AssistantAuditEntry,
    TransformRecord,
)
from app.use_cases.assistant_audit import toggle_audit_entry
from app.use_cases.assistant_audit.exceptions import (
    AuditEntryNotFound,
    AuditEntryNotToggleable,
)
from tests.uuidv7_fixtures import (
    AUDIT_ENTRY_1,
    AUDIT_ENTRY_2,
    DATASET_1,
    ORG_1,
    PROJECT_1,
    TRANSFORM_1,
)


def _entry(entry_id, *, org_id=ORG_1, project_id=PROJECT_1, node_id=DATASET_1):
    return AssistantAuditEntry(
        id=entry_id,
        org_id=org_id,
        project_id=project_id,
        node_id=node_id,
        node_kind="dataset",
        payload={"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
        sequence=0,
    )


def _transform(*, status="enabled", audit_entry_id=AUDIT_ENTRY_1):
    return TransformRecord(
        id=TRANSFORM_1,
        dataset_id=DATASET_1,
        name="trim email",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="email = 'x'",
        status=status,
        assistant_audit_entry_id=audit_entry_id,
    )


class TestToggleAuditEntry:
    async def test_disables_the_pointing_transform_when_enabled_false(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(_entry(AUDIT_ENTRY_1))
        seeded_db.add(_transform(status="enabled"))
        await seeded_db.commit()

        result = await toggle_audit_entry(AUDIT_ENTRY_1, enabled=False, org_id=ORG_1)

        match result:
            case Success(entry):
                assert entry["node_id"] == DATASET_1
            case Failure(error):
                pytest.fail(f"expected success, got {error}")

        row = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        assert row.scalar_one().status == "disabled"

    async def test_enables_the_pointing_transform_when_enabled_true(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        seeded_db.add(_entry(AUDIT_ENTRY_1))
        seeded_db.add(_transform(status="disabled"))
        await seeded_db.commit()

        await toggle_audit_entry(AUDIT_ENTRY_1, enabled=True, org_id=ORG_1)

        row = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        assert row.scalar_one().status == "enabled"

    async def test_toggle_changes_the_recompiled_enabled_transform_set(self, seeded_db: AsyncSession):
        """A recompile-affecting assertion: the dataset's ENABLED-transform set
        (what ``Dataset.staging_sql`` folds) shrinks when the transform is
        disabled — the toggle reaches the same recompile machinery as the
        existing transform-status write path."""
        set_session(seeded_db)
        seeded_db.add(_entry(AUDIT_ENTRY_1))
        seeded_db.add(_transform(status="enabled"))
        await seeded_db.commit()

        # Before: one enabled transform participates in the recompile.
        ds_before = await self._load_dataset(seeded_db)
        assert sum(1 for t in ds_before.transforms if t.is_enabled) == 1

        await toggle_audit_entry(AUDIT_ENTRY_1, enabled=False, org_id=ORG_1)

        seeded_db.expire_all()
        ds_after = await self._load_dataset(seeded_db)
        assert sum(1 for t in ds_after.transforms if t.is_enabled) == 0

    @staticmethod
    async def _load_dataset(db: AsyncSession) -> Dataset:
        from app.repositories import RestrictedSession
        from app.repositories.metadata import MetadataRepository

        repo = MetadataRepository(RestrictedSession(db))
        record = await repo.get_dataset_record(DATASET_1)
        return Dataset.from_record(record)

    async def test_log_only_entry_is_not_toggleable(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # An entry with NO transform pointing at it (log-only) cannot toggle.
        seeded_db.add(_entry(AUDIT_ENTRY_2))
        await seeded_db.commit()

        result = await toggle_audit_entry(AUDIT_ENTRY_2, enabled=False, org_id=ORG_1)

        match result:
            case Failure(error):
                assert isinstance(error, AuditEntryNotToggleable)
            case Success(_):
                pytest.fail("expected not-toggleable failure for a log-only entry")

    async def test_missing_entry_fails(self, seeded_db: AsyncSession):
        set_session(seeded_db)

        result = await toggle_audit_entry("nonexistent", enabled=False, org_id=ORG_1)

        match result:
            case Failure(error):
                assert isinstance(error, AuditEntryNotFound)
            case Success(_):
                pytest.fail("expected not-found failure for a missing entry")

    async def test_org_scoping_hides_other_org_entry(self, seeded_db: AsyncSession):
        set_session(seeded_db)
        # The entry exists but belongs to ORG_1; a request from another org must
        # not find it (cross-org is indistinguishable from not-found).
        seeded_db.add(_entry(AUDIT_ENTRY_1))
        seeded_db.add(_transform(status="enabled"))
        await seeded_db.commit()

        result = await toggle_audit_entry(AUDIT_ENTRY_1, enabled=False, org_id="some-other-org")

        match result:
            case Failure(error):
                assert isinstance(error, AuditEntryNotFound)
            case Success(_):
                pytest.fail("expected not-found for cross-org access")

        # The transform must be untouched.
        row = await seeded_db.execute(select(TransformRecord).where(TransformRecord.id == TRANSFORM_1))
        assert row.scalar_one().status == "enabled"
