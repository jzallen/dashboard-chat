"""Tests for create_report use case.

ADR-026 MR-3 / Phase 03-03: the legacy literal ``sql_definition`` input
parameter has been removed. The storage column is now ALWAYS derived by
``ReportIbisCompiler`` from structured ``columns_metadata`` (any
``semantic_role`` of ``dimension`` / ``measure``); reports submitted with
neither dimension nor measure entries (e.g., entity-only or fully-empty
columns_metadata) round-trip with an empty ``sql_definition`` storage value
— step 03-04 of the deliver wave introduces the modeling-violation
rejection for measures-without-dimensions; until then a bare entity-only
report is a structurally valid persistence shape.

The remaining ``sql_definition`` parameter on ``create_report`` is the
deprecation-rejection seam (DWD-5): a caller that still supplies the field
gets a structured :class:`DeprecatedSqlDefinitionField` failure naming the
field, rather than a silent drop.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.report import create_report
from app.use_cases.report.column_validation import InvalidColumnMetadata
from app.use_cases.report.exceptions import (
    DeprecatedSqlDefinitionField,
    InvalidReportReference,
)
from app.use_cases.view.exceptions import InvalidSourceReference
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1, VIEW_1

# Fixtures used by the structured-composition assertions. Tests below pass
# ``DATASET_1`` as the source_ref; the seeded_db conftest registers it with
# an empty schema_config, so the compiler falls back to ``string`` for any
# referenced columns. That is sufficient for the structural assertions
# (GROUP BY presence, alias projection) the use-case-level contract pins —
# row-level evaluation lives in the acceptance suite, not here.
_REGION_DIM = {
    "name": "region",
    "semantic_role": "dimension",
    "semantic_type": "categorical",
    "source_column": "region",
    "source_ref": DATASET_1,
}
_COUNT_MEASURE = {
    "name": "order_count",
    "semantic_role": "measure",
    "semantic_type": "count",
    "source_column": "order_id",
    "source_ref": DATASET_1,
}


class TestCreateReport:
    """Tests for create_report workflow."""

    async def test_create_report_with_required_fields(self, seeded_db: AsyncSession):
        """create_report should create a report with required fields.

        With no columns_metadata supplied the compiler has nothing to compose,
        so the storage ``sql_definition`` round-trips as an empty string per
        the 03-03 contract. The report is still persisted — the empty-sql
        gating belongs to the report-modeling rejection (step 03-04) not the
        use-case input boundary.
        """
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="My Report",
            report_type="fact",
        )

        match result:
            case Success(report):
                assert report.name == "My Report"
                # Empty columns_metadata → no compiled SQL → empty storage string.
                assert report.sql_definition == ""
                assert report.project_id == PROJECT_1
                assert report.report_type == "fact"
                assert report.materialization == "view"
                assert report.source_refs == []
                assert report.domain == "Organization"
                assert report.columns_metadata == []
            case Failure(error):
                pytest.fail(f"create_report should succeed, got: {error}")

    async def test_create_report_with_all_fields(self, seeded_db: AsyncSession):
        """create_report should accept all optional fields and compile SQL.

        With a dimension + measure in ``columns_metadata`` the compiler
        derives the storage ``sql_definition`` end-to-end; the assertion
        pins the contract that the stored SQL is a real compiled
        aggregation, not the legacy literal-string input.
        """
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Full Report",
            report_type="dimension",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
            description="A description",
            domain="Sales",
            columns_metadata=[_REGION_DIM, _COUNT_MEASURE],
            materialization="table",
        )

        match result:
            case Success(report):
                assert report.description == "A description"
                assert report.report_type == "dimension"
                assert report.domain == "Sales"
                assert report.materialization == "table"
                assert len(report.source_refs) == 1
                assert len(report.columns_metadata) == 2
                # The stored sql_definition is the compiler's output —
                # structurally an aggregation with GROUP BY, not the
                # literal SELECT string the legacy contract accepted.
                compiled = report.sql_definition.lower()
                assert "group by" in compiled, f"compiled sql_definition is missing GROUP BY: {report.sql_definition!r}"
                assert "count(" in compiled, (
                    f"compiled sql_definition is missing count aggregation: {report.sql_definition!r}"
                )
            case Failure(error):
                pytest.fail(f"create_report should succeed, got: {error}")

    async def test_create_report_with_view_source_ref(self, seeded_db: AsyncSession):
        """create_report should accept view source references."""
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="Report from View",
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
            report_type="fact",
            columns_metadata=[{"name": "col", "semantic_role": "entity", "semantic_type": "sum"}],
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidColumnMetadata)
            case Success(_):
                pytest.fail("create_report should fail with invalid column metadata")

    async def test_create_report_rejects_deprecated_sql_definition(self, seeded_db: AsyncSession):
        """create_report should reject the deprecated sql_definition input.

        Per ADR-026 §"Decision outcome" item 2 the report-creation use case
        no longer accepts free-form SQL. A caller still supplying the
        deprecated ``sql_definition`` parameter receives a structured
        :class:`DeprecatedSqlDefinitionField` failure naming the field — not
        a silent drop. The rejection happens BEFORE any project / source-ref
        validation (and crucially before the repository write), so the
        compiler is never invoked.
        """
        set_session(seeded_db)

        result = await create_report(
            project_id=PROJECT_1,
            name="rogue_report",
            report_type="fact",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
            columns_metadata=[],
            sql_definition="SELECT 1",
        )

        match result:
            case Failure(error):
                assert isinstance(error, DeprecatedSqlDefinitionField), (
                    f"expected DeprecatedSqlDefinitionField, got {type(error).__name__}: {error}"
                )
                # The message names the deprecated field so analysts see
                # *what* to remove from their tool call.
                assert "sql_definition" in str(error), f"deprecation message must name the deprecated field: {error}"
            case Success(_):
                pytest.fail("create_report must reject the deprecated sql_definition input")
