"""Tests for update_report use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.report import update_report
from app.use_cases.report.column_validation import InvalidColumnMetadata
from app.use_cases.report.exceptions import InvalidReportReference, ReportNotFound
from tests.uuidv7_fixtures import DATASET_1, REPORT_1


class TestUpdateReport:
    """Tests for update_report workflow."""

    async def test_update_report_name(self, seeded_db_with_report: AsyncSession):
        """update_report should update the report name."""
        set_session(seeded_db_with_report)

        result = await update_report(REPORT_1, {"name": "Updated Name"})

        match result:
            case Success(report):
                assert report.name == "Updated Name"
                assert report.id == REPORT_1
            case Failure(error):
                pytest.fail(f"update_report should succeed, got: {error}")

    async def test_update_report_sql_definition(self, seeded_db_with_report: AsyncSession):
        """update_report should update the SQL definition."""
        set_session(seeded_db_with_report)

        result = await update_report(REPORT_1, {"sql_definition": "SELECT new_col FROM t"})

        match result:
            case Success(report):
                assert report.sql_definition == "SELECT new_col FROM t"
            case Failure(error):
                pytest.fail(f"update_report should succeed, got: {error}")

    async def test_update_report_source_refs_validates(self, seeded_db_with_report: AsyncSession):
        """update_report should validate new source_refs."""
        set_session(seeded_db_with_report)

        result = await update_report(
            REPORT_1,
            {"source_refs": [{"id": DATASET_1, "type": "dataset"}]},
        )

        match result:
            case Success(report):
                assert len(report.source_refs) == 1
            case Failure(error):
                pytest.fail(f"update_report should succeed with valid refs, got: {error}")

    async def test_update_report_invalid_source_refs(self, seeded_db_with_report: AsyncSession):
        """update_report should fail with invalid source_refs."""
        set_session(seeded_db_with_report)

        result = await update_report(
            REPORT_1,
            {"source_refs": [{"id": "nonexistent", "type": "dataset"}]},
        )

        match result:
            case Failure(_):
                pass  # Expected
            case Success(_):
                pytest.fail("update_report should fail with invalid source refs")

    async def test_update_report_rejects_report_source_ref(self, seeded_db_with_report: AsyncSession):
        """update_report should fail when source refs include a report."""
        set_session(seeded_db_with_report)

        result = await update_report(
            REPORT_1,
            {"source_refs": [{"id": "some-report", "type": "report"}]},
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidReportReference)
            case Success(_):
                pytest.fail("update_report should fail with report source refs")

    async def test_update_report_invalid_columns_metadata(self, seeded_db_with_report: AsyncSession):
        """update_report should fail with invalid column metadata."""
        set_session(seeded_db_with_report)

        result = await update_report(
            REPORT_1,
            {"columns_metadata": [{"name": "col", "semantic_role": "entity", "semantic_type": "sum"}]},
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidColumnMetadata)
            case Success(_):
                pytest.fail("update_report should fail with invalid column metadata")

    async def test_update_nonexistent_report(self, seeded_db: AsyncSession):
        """update_report should fail for nonexistent report."""
        set_session(seeded_db)

        result = await update_report("nonexistent-id", {"name": "New"})

        match result:
            case Failure(error):
                assert isinstance(error, ReportNotFound)
            case Success(_):
                pytest.fail("update_report should fail for nonexistent report")
