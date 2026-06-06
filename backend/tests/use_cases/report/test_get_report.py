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

    async def test_fetched_report_serializes_timestamps_at_boundary(self, seeded_db_with_report: AsyncSession):
        """The Report returned by get_report must serialize() without raising.

        Regression for the latent HTTP 500 on GET /api/projects/{id}/report/{id}:
        same root cause as create_report — the repository mapper stringified
        timestamps too early, so the re-hydrated Report held a ``str`` in
        ``created_at`` and ``serialize()`` raised AttributeError.
        """
        set_session(seeded_db_with_report)

        result = await get_report(REPORT_1)

        match result:
            case Success(report):
                payload = report.serialize()  # must NOT raise
                _assert_iso_8601(payload["created_at"])
                _assert_iso_8601(payload["updated_at"])
            case Failure(error):
                pytest.fail(f"get_report should succeed, got: {error}")


def _assert_iso_8601(value: object) -> None:
    """Assert the value is an ISO-8601 datetime string parseable round-trip."""
    from datetime import datetime

    assert isinstance(value, str), f"expected ISO-8601 string, got {type(value).__name__}: {value!r}"
    datetime.fromisoformat(value)  # raises ValueError if not ISO-8601
