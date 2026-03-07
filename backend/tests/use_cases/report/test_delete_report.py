"""Tests for delete_report use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.report import delete_report
from app.use_cases.report.exceptions import ReportNotFound
from tests.uuidv7_fixtures import REPORT_1


class TestDeleteReport:
    """Tests for delete_report workflow."""

    async def test_delete_existing_report(self, seeded_db_with_report: AsyncSession):
        """delete_report should delete an existing report."""
        set_session(seeded_db_with_report)

        result = await delete_report(REPORT_1)

        match result:
            case Success(deleted):
                assert deleted is True
            case Failure(error):
                pytest.fail(f"delete_report should succeed, got: {error}")

    async def test_delete_nonexistent_report(self, seeded_db: AsyncSession):
        """delete_report should fail for nonexistent report."""
        set_session(seeded_db)

        result = await delete_report("nonexistent-id")

        match result:
            case Failure(error):
                assert isinstance(error, ReportNotFound)
            case Success(_):
                pytest.fail("delete_report should fail for nonexistent report")
