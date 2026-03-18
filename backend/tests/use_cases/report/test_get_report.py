"""Tests for get_report use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.report import get_report
from app.use_cases.report.exceptions import ReportNotFound
from tests.uuidv7_fixtures import REPORT_1


class TestGetReport:
    """Tests for get_report workflow."""

    async def test_get_existing_report(self, seeded_db_with_report: AsyncSession):
        """get_report should return a Report when it exists."""
        set_session(seeded_db_with_report)

        result = await get_report(REPORT_1)

        match result:
            case Success(report):
                assert report.id == REPORT_1
                assert report.name == "Existing Report"
                assert report.sql_definition == "SELECT * FROM view"
                assert report.report_type == "fact"
            case Failure(error):
                pytest.fail(f"get_report should succeed, got: {error}")

    async def test_get_nonexistent_report(self, seeded_db: AsyncSession):
        """get_report should return Failure with ReportNotFound."""
        set_session(seeded_db)

        result = await get_report("nonexistent-id")

        match result:
            case Failure(error):
                assert isinstance(error, ReportNotFound)
            case Success(_):
                pytest.fail("get_report should fail for nonexistent report")
