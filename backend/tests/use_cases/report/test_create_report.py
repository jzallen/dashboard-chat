"""Tests for create_report use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.report import create_report
from app.use_cases.report.column_validation import InvalidColumnMetadata
from app.use_cases.report.exceptions import InvalidReportReference
from app.use_cases.view.exceptions import InvalidSourceReference
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1, VIEW_1


class TestCreateReport:
    """Tests for create_report workflow."""

    async def test_create_report_with_required_fields(self, seeded_db: AsyncSession):
        """create_report should create a report with required fields."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="My Report",
            sql_definition="SELECT * FROM source",
            report_type="fact",
        )

        match result:
            case Success(report):
                assert report.name == "My Report"
                assert report.sql_definition == "SELECT * FROM source"
                assert report.project_id == PROJECT_1
                assert report.report_type == "fact"
                assert report.materialization == "view"
                assert report.source_refs == []
                assert report.domain == "Organization"
                assert report.columns_metadata == []
            case Failure(error):
                pytest.fail(f"create_report should succeed, got: {error}")

    async def test_create_report_with_all_fields(self, seeded_db: AsyncSession):
        """create_report should accept all optional fields."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Full Report",
            sql_definition="SELECT a FROM b",
            report_type="dimension",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
            description="A description",
            domain="Sales",
            columns_metadata=[{"name": "id", "semantic_role": "entity", "semantic_type": "primary"}],
            materialization="table",
        )

        match result:
            case Success(report):
                assert report.description == "A description"
                assert report.report_type == "dimension"
                assert report.domain == "Sales"
                assert report.materialization == "table"
                assert len(report.source_refs) == 1
                assert len(report.columns_metadata) == 1
            case Failure(error):
                pytest.fail(f"create_report should succeed, got: {error}")

    async def test_create_report_with_view_source_ref(self, seeded_db: AsyncSession):
        """create_report should accept view source references."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Report from View",
            sql_definition="SELECT * FROM view",
            report_type="fact",
            source_refs=[{"id": VIEW_1, "type": "view"}],
        )

        match result:
            case Success(report):
                assert len(report.source_refs) == 1
                assert report.source_refs[0]["type"] == "view"
            case Failure(error):
                pytest.fail(f"create_report should succeed, got: {error}")

    async def test_create_report_with_invalid_source_ref(self, seeded_db: AsyncSession):
        """create_report should fail when source refs are invalid."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Bad Report",
            sql_definition="SELECT 1",
            report_type="fact",
            source_refs=[{"id": "nonexistent", "type": "dataset"}],
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidSourceReference)
            case Success(_):
                pytest.fail("create_report should fail with invalid source refs")

    async def test_create_report_rejects_report_source_ref(self, seeded_db: AsyncSession):
        """create_report should fail when source refs include a report (no mart-to-mart)."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Bad Report",
            sql_definition="SELECT 1",
            report_type="fact",
            source_refs=[{"id": "some-report", "type": "report"}],
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidReportReference)
            case Success(_):
                pytest.fail("create_report should fail with report source refs")

    async def test_create_report_with_nonexistent_project(self, seeded_db: AsyncSession):
        """create_report should fail when project does not exist."""
        set_session(seeded_db)

        result = await create_report(
            project_id="nonexistent-project",
            name="My Report",
            sql_definition="SELECT 1",
            report_type="fact",
        )

        match result:
            case Failure(_):
                pass  # Expected
            case Success(_):
                pytest.fail("create_report should fail with nonexistent project")

    async def test_create_report_with_invalid_columns_metadata(self, seeded_db: AsyncSession):
        """create_report should fail with invalid column metadata."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Bad Report",
            sql_definition="SELECT 1",
            report_type="fact",
            columns_metadata=[{"name": "col", "semantic_role": "entity", "semantic_type": "sum"}],
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidColumnMetadata)
            case Success(_):
                pytest.fail("create_report should fail with invalid column metadata")
