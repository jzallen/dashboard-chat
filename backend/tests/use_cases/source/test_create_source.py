"""Tests for the create_source use case.

Port-to-port: enters through the use-case driving port, asserts on the
returned Source dict and the emitted SourceCreated outbox event (driven-port
boundary). Project existence/authorization is validated before creation.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.source import create_source
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed ORG_1 + PROJECT_1 (the FK + authorization prerequisite)."""
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.commit()
    return db_session


class TestCreateSource:
    async def test_creates_source_for_existing_project(self, seeded_db: AsyncSession):
        """create_source returns the persisted Source dict for a valid project."""
        set_session(seeded_db)

        result = await create_source(
            project_id=PROJECT_1,
            name="Patients",
            user=TEST_USER,
            schema_config={"fields": {"patient_id": {"type": "text"}}},
        )

        match result:
            case Success(source):
                assert source["project_id"] == PROJECT_1
                assert source["name"] == "Patients"
                assert source["schema_config"] == {"fields": {"patient_id": {"type": "text"}}}
                assert source["created_by"] == USER_1
                assert "id" in source
                assert source["created_at"] is not None
            case Failure(error):
                pytest.fail(f"create_source should succeed, got: {error}")

    async def test_emits_source_created_outbox_event(self, seeded_db: AsyncSession):
        """create_source emits a SourceCreated event for the new source."""
        from app.repositories import RestrictedSession
        from app.repositories.outbox import OutboxRepository

        set_session(seeded_db)

        result = await create_source(project_id=PROJECT_1, name="Patients", user=TEST_USER)

        source = result.unwrap()
        outbox = OutboxRepository(RestrictedSession(seeded_db))
        pending = await outbox.get_pending_event("source", source["id"], "SourceCreated")
        assert pending is not None
        assert pending.payload["source_id"] == source["id"]
        assert pending.payload["project_id"] == PROJECT_1
        assert pending.payload["created_by"] == USER_1

    async def test_fails_when_project_not_found(self, db_session: AsyncSession):
        """create_source returns Failure(ProjectNotFound) for an unknown project."""
        set_session(db_session)

        result = await create_source(
            project_id="019515a0-00ff-7000-8000-0000000000ff",
            name="Patients",
            user=TEST_USER,
        )

        match result:
            case Failure(error):
                assert isinstance(error, ProjectNotFound)
            case Success(_):
                pytest.fail("create_source should fail for a nonexistent project")
