"""Tests for View CRUD operations in MetadataRepository."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.metadata import MetadataRepository, ProjectRecord, ViewRecord
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, VIEW_1, VIEW_2


@pytest.fixture
async def repo_with_project(db_session: AsyncSession):
    """Seed a project and return the repository."""
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    db_session.add(project)
    await db_session.commit()

    repo = MetadataRepository(RestrictedSession(db_session))
    return repo


class TestCreateView:
    """Tests for create_view."""

    async def test_create_view_returns_dict(self, repo_with_project):
        repo = repo_with_project
        result = await repo.create_view(
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="My View",
            sql_definition="SELECT * FROM source",
        )
        assert result["name"] == "My View"
        assert result["sql_definition"] == "SELECT * FROM source"
        assert result["project_id"] == PROJECT_1
        assert result["org_id"] == ORG_1
        assert result["materialization"] == "ephemeral"
        assert result["source_refs"] == []
        assert result["id"] is not None
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_create_view_with_all_fields(self, repo_with_project):
        repo = repo_with_project
        refs = [{"id": "ds-1", "type": "dataset"}]
        result = await repo.create_view(
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="Full View",
            sql_definition="SELECT a FROM b",
            source_refs=refs,
            description="A description",
            materialization="table",
        )
        assert result["description"] == "A description"
        assert result["materialization"] == "table"
        assert result["source_refs"] == refs


class TestGetView:
    """Tests for get_view."""

    async def test_get_view_found(self, repo_with_project, db_session):
        repo = repo_with_project
        view = ViewRecord(
            id=VIEW_1,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="Test View",
            sql_definition="SELECT 1",
        )
        db_session.add(view)
        await db_session.commit()

        result = await repo.get_view(VIEW_1)
        assert result is not None
        assert result["id"] == VIEW_1
        assert result["name"] == "Test View"

    async def test_get_view_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.get_view("nonexistent-id")
        assert result is None


class TestListViewsByProject:
    """Tests for list_views_by_project."""

    async def test_list_views_returns_records(self, repo_with_project, db_session):
        repo = repo_with_project
        v1 = ViewRecord(id=VIEW_1, project_id=PROJECT_1, org_id=ORG_1, name="View 1", sql_definition="SELECT 1")
        v2 = ViewRecord(id=VIEW_2, project_id=PROJECT_1, org_id=ORG_1, name="View 2", sql_definition="SELECT 2")
        db_session.add(v1)
        db_session.add(v2)
        await db_session.commit()

        results = await repo.list_views_by_project(PROJECT_1)
        assert len(results) == 2
        names = {r.name for r in results}
        assert names == {"View 1", "View 2"}

    async def test_list_views_empty_project(self, repo_with_project):
        repo = repo_with_project
        results = await repo.list_views_by_project(PROJECT_1)
        assert results == []


class TestUpdateView:
    """Tests for update_view."""

    async def test_update_view_returns_updated_record(self, repo_with_project, db_session):
        repo = repo_with_project
        view = ViewRecord(id=VIEW_1, project_id=PROJECT_1, org_id=ORG_1, name="Old Name", sql_definition="SELECT 1")
        db_session.add(view)
        await db_session.commit()

        result = await repo.update_view(VIEW_1, name="New Name", sql_definition="SELECT 2")
        assert result is not None
        assert result.name == "New Name"
        assert result.sql_definition == "SELECT 2"

    async def test_update_view_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.update_view("nonexistent-id", name="New")
        assert result is None


class TestDeleteView:
    """Tests for delete_view."""

    async def test_delete_view_returns_true(self, repo_with_project, db_session):
        repo = repo_with_project
        view = ViewRecord(id=VIEW_1, project_id=PROJECT_1, org_id=ORG_1, name="To Delete", sql_definition="SELECT 1")
        db_session.add(view)
        await db_session.commit()

        result = await repo.delete_view(VIEW_1)
        assert result is True

        # Verify it's gone
        assert await repo.get_view(VIEW_1) is None

    async def test_delete_view_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.delete_view("nonexistent-id")
        assert result is False


class TestViewExists:
    """Tests for view_exists."""

    async def test_view_exists_true(self, repo_with_project, db_session):
        repo = repo_with_project
        view = ViewRecord(id=VIEW_1, project_id=PROJECT_1, org_id=ORG_1, name="Exists", sql_definition="SELECT 1")
        db_session.add(view)
        await db_session.commit()

        assert await repo.view_exists(VIEW_1) is True

    async def test_view_exists_false(self, repo_with_project):
        repo = repo_with_project
        assert await repo.view_exists("nonexistent-id") is False
