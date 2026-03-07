"""Tests for Report CRUD operations in MetadataRepository."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import RestrictedSession
from app.repositories.metadata import MetadataRepository, ProjectRecord, ReportRecord
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, REPORT_1, REPORT_2


@pytest.fixture
async def repo_with_project(db_session: AsyncSession):
    """Seed a project and return the repository."""
    project = ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1)
    db_session.add(project)
    await db_session.commit()

    repo = MetadataRepository(RestrictedSession(db_session))
    return repo


class TestCreateReport:
    """Tests for create_report."""

    async def test_create_report_returns_dict(self, repo_with_project):
        repo = repo_with_project
        result = await repo.create_report(
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="My Report",
            sql_definition="SELECT * FROM source",
            report_type="fact",
        )
        assert result["name"] == "My Report"
        assert result["sql_definition"] == "SELECT * FROM source"
        assert result["project_id"] == PROJECT_1
        assert result["org_id"] == ORG_1
        assert result["report_type"] == "fact"
        assert result["domain"] == "Organization"
        assert result["materialization"] == "view"
        assert result["source_refs"] == []
        assert result["columns_metadata"] == []
        assert result["id"] is not None
        assert result["created_at"] is not None
        assert result["updated_at"] is not None

    async def test_create_report_with_all_fields(self, repo_with_project):
        repo = repo_with_project
        refs = [{"id": "ds-1", "type": "dataset"}]
        cols = [{"name": "revenue", "semantic_role": "measure", "semantic_type": "sum"}]
        result = await repo.create_report(
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="Full Report",
            sql_definition="SELECT a FROM b",
            report_type="dimension",
            source_refs=refs,
            description="A description",
            domain="Sales",
            columns_metadata=cols,
            materialization="table",
        )
        assert result["description"] == "A description"
        assert result["report_type"] == "dimension"
        assert result["domain"] == "Sales"
        assert result["materialization"] == "table"
        assert result["source_refs"] == refs
        assert result["columns_metadata"] == cols


class TestGetReport:
    """Tests for get_report."""

    async def test_get_report_found(self, repo_with_project, db_session):
        repo = repo_with_project
        report = ReportRecord(
            id=REPORT_1,
            project_id=PROJECT_1,
            org_id=ORG_1,
            name="Test Report",
            sql_definition="SELECT 1",
            report_type="fact",
        )
        db_session.add(report)
        await db_session.commit()

        result = await repo.get_report(REPORT_1)
        assert result is not None
        assert result["id"] == REPORT_1
        assert result["name"] == "Test Report"
        assert result["report_type"] == "fact"

    async def test_get_report_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.get_report("nonexistent-id")
        assert result is None


class TestListReportsByProject:
    """Tests for list_reports_by_project."""

    async def test_list_reports_returns_records(self, repo_with_project, db_session):
        repo = repo_with_project
        r1 = ReportRecord(
            id=REPORT_1, project_id=PROJECT_1, org_id=ORG_1,
            name="Report 1", sql_definition="SELECT 1", report_type="fact",
        )
        r2 = ReportRecord(
            id=REPORT_2, project_id=PROJECT_1, org_id=ORG_1,
            name="Report 2", sql_definition="SELECT 2", report_type="dimension",
        )
        db_session.add(r1)
        db_session.add(r2)
        await db_session.commit()

        results = await repo.list_reports_by_project(PROJECT_1)
        assert len(results) == 2
        names = {r.name for r in results}
        assert names == {"Report 1", "Report 2"}

    async def test_list_reports_empty_project(self, repo_with_project):
        repo = repo_with_project
        results = await repo.list_reports_by_project(PROJECT_1)
        assert results == []


class TestUpdateReport:
    """Tests for update_report."""

    async def test_update_report_returns_updated_record(self, repo_with_project, db_session):
        repo = repo_with_project
        report = ReportRecord(
            id=REPORT_1, project_id=PROJECT_1, org_id=ORG_1,
            name="Old Name", sql_definition="SELECT 1", report_type="fact",
        )
        db_session.add(report)
        await db_session.commit()

        result = await repo.update_report(REPORT_1, name="New Name", sql_definition="SELECT 2")
        assert result is not None
        assert result.name == "New Name"
        assert result.sql_definition == "SELECT 2"

    async def test_update_report_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.update_report("nonexistent-id", name="New")
        assert result is None


class TestDeleteReport:
    """Tests for delete_report."""

    async def test_delete_report_returns_true(self, repo_with_project, db_session):
        repo = repo_with_project
        report = ReportRecord(
            id=REPORT_1, project_id=PROJECT_1, org_id=ORG_1,
            name="To Delete", sql_definition="SELECT 1", report_type="fact",
        )
        db_session.add(report)
        await db_session.commit()

        result = await repo.delete_report(REPORT_1)
        assert result is True

        # Verify it's gone
        assert await repo.get_report(REPORT_1) is None

    async def test_delete_report_not_found(self, repo_with_project):
        repo = repo_with_project
        result = await repo.delete_report("nonexistent-id")
        assert result is False


class TestReportExists:
    """Tests for report_exists."""

    async def test_report_exists_true(self, repo_with_project, db_session):
        repo = repo_with_project
        report = ReportRecord(
            id=REPORT_1, project_id=PROJECT_1, org_id=ORG_1,
            name="Exists", sql_definition="SELECT 1", report_type="fact",
        )
        db_session.add(report)
        await db_session.commit()

        assert await repo.report_exists(REPORT_1) is True

    async def test_report_exists_false(self, repo_with_project):
        repo = repo_with_project
        assert await repo.report_exists("nonexistent-id") is False
