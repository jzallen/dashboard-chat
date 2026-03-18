"""Tests for ExternalAccessRepository CRUD operations."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.exceptions import ExternalAccessRepositoryError
from app.repositories.external_access import AccessRecordView, ExternalAccessRepository
from app.repositories.metadata import ProjectRecord
from tests.uuidv7_fixtures import ORG_1, PROJECT_1


@pytest.fixture
async def repo(db_session: AsyncSession):
    """Create a repository instance with a restricted session."""
    # Seed a project for FK constraint
    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    db_session.add(project)
    await db_session.commit()

    return ExternalAccessRepository(RestrictedSession(db_session))


class TestExternalAccessRepository:
    async def test_create_returns_access_record_view_with_all_fields(self, repo):
        result = await repo.create(
            project_id=PROJECT_1,
            org_id=ORG_1,
            pg_schema="project_project_",
            pg_role="reader_project_",
            pg_password_hash="$2b$12$hashvalue",
        )

        assert isinstance(result, AccessRecordView)
        assert result.project_id == PROJECT_1
        assert result.org_id == ORG_1
        assert result.pg_schema == "project_project_"
        assert result.pg_role == "reader_project_"
        assert result.environment_id is None
        assert result.environment_host is None
        assert result.environment_port is None
        assert result.proxy_container_id is None
        assert result.environment_status == "running"
        assert result.status_message is None
        assert result.is_legacy is True
        assert result.enabled is True
        assert result.last_synced_at is None
        assert result.id is not None
        assert result.created_at is not None
        assert result.updated_at is not None
        # pg_password_hash is intentionally excluded from AccessRecordView
        assert not hasattr(result, "pg_password_hash") or type(result) is AccessRecordView

    async def test_get_by_project_id_returns_record(self, repo):
        await repo.create(
            project_id=PROJECT_1,
            org_id=ORG_1,
            pg_schema="project_project_",
            pg_role="reader_project_",
            pg_password_hash="$2b$12$hashvalue",
        )

        result = await repo.get_by_project_id(PROJECT_1)

        assert result is not None
        assert result.project_id == PROJECT_1
        assert result.enabled is True

    async def test_get_by_project_id_returns_none_for_nonexistent(self, repo):
        result = await repo.get_by_project_id("nonexistent")
        assert result is None

    async def test_update_changes_fields(self, repo):
        await repo.create(
            project_id=PROJECT_1,
            org_id=ORG_1,
            pg_schema="project_project_",
            pg_role="reader_project_",
            pg_password_hash="$2b$12$oldhash",
        )

        result = await repo.update(
            PROJECT_1,
            {
                "pg_role": "reader_updated_",
            },
        )

        assert result is not None
        assert result.pg_role == "reader_updated_"

    async def test_update_returns_none_for_nonexistent(self, repo):
        result = await repo.update("nonexistent", {"enabled": False})
        assert result is None

    async def test_soft_disable_sets_enabled_false(self, repo):
        await repo.create(
            project_id=PROJECT_1,
            org_id=ORG_1,
            pg_schema="project_project_",
            pg_role="reader_project_",
            pg_password_hash="$2b$12$hashvalue",
        )

        result = await repo.soft_disable(PROJECT_1)

        assert result is not None
        assert result.project_id == PROJECT_1
        assert result.enabled is False

    async def test_soft_disable_returns_none_for_nonexistent(self, repo):
        result = await repo.soft_disable("nonexistent")
        assert result is None

    async def test_create_unique_constraint_on_project_id(self, repo):
        """Creating two records for the same project should fail."""
        await repo.create(
            project_id=PROJECT_1,
            org_id=ORG_1,
            pg_schema="project_project_",
            pg_role="reader_project_",
            pg_password_hash="$2b$12$hash1",
        )

        with pytest.raises(ExternalAccessRepositoryError):
            await repo.create(
                project_id=PROJECT_1,
                org_id=ORG_1,
                pg_schema="project_project_",
                pg_role="reader_project_",
                pg_password_hash="$2b$12$hash2",
            )
