"""Tests for Report domain model."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models.report import Report


class TestReportConstruction:
    """Tests for Report dataclass construction."""

    def test_create_report_with_required_fields(self):
        """Report should be constructable with required fields only."""
        report = Report(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            sql_definition="SELECT * FROM source",
            report_type="fact",
        )
        assert report.id == "report-1"
        assert report.project_id == "proj-1"
        assert report.org_id == "org-1"
        assert report.name == "My Report"
        assert report.sql_definition == "SELECT * FROM source"
        assert report.report_type == "fact"
        assert report.source_refs == []
        assert report.description is None
        assert report.domain == "Organization"
        assert report.columns_metadata == []
        assert report.materialization == "view"
        assert report.created_at is None
        assert report.updated_at is None

    def test_create_report_with_all_fields(self):
        """Report should accept all optional fields."""
        now = datetime.now(UTC)
        refs = [{"id": "ds-1", "type": "dataset"}]
        cols = [{"name": "revenue", "semantic_role": "measure", "semantic_type": "sum"}]
        report = Report(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            sql_definition="SELECT * FROM source",
            report_type="dimension",
            source_refs=refs,
            description="A test report",
            domain="Sales",
            columns_metadata=cols,
            materialization="table",
            created_at=now,
            updated_at=now,
        )
        assert report.source_refs == refs
        assert report.description == "A test report"
        assert report.report_type == "dimension"
        assert report.domain == "Sales"
        assert report.columns_metadata == cols
        assert report.materialization == "table"
        assert report.created_at == now
        assert report.updated_at == now

    def test_report_is_frozen(self):
        """Report should be immutable (frozen dataclass)."""
        report = Report(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            sql_definition="SELECT 1",
            report_type="fact",
        )
        with pytest.raises(AttributeError):
            report.name = "Changed"


class TestReportSerialization:
    """Tests for Report.serialize()."""

    def test_serialize_with_timestamps(self):
        """serialize should include ISO-formatted timestamps."""
        now = datetime(2026, 3, 6, 12, 0, 0)
        report = Report(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            sql_definition="SELECT * FROM source",
            report_type="fact",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            description="A test",
            domain="Sales",
            columns_metadata=[{"name": "revenue", "semantic_role": "measure", "semantic_type": "sum"}],
            materialization="view",
            created_at=now,
            updated_at=now,
        )
        result = report.serialize()
        assert result["id"] == "report-1"
        assert result["project_id"] == "proj-1"
        assert result["org_id"] == "org-1"
        assert result["name"] == "My Report"
        assert result["sql_definition"] == "SELECT * FROM source"
        assert result["report_type"] == "fact"
        assert result["source_refs"] == [{"id": "ds-1", "type": "dataset"}]
        assert result["description"] == "A test"
        assert result["domain"] == "Sales"
        assert result["columns_metadata"] == [{"name": "revenue", "semantic_role": "measure", "semantic_type": "sum"}]
        assert result["materialization"] == "view"
        assert result["created_at"] == "2026-03-06T12:00:00"
        assert result["updated_at"] == "2026-03-06T12:00:00"

    def test_serialize_with_none_timestamps(self):
        """serialize should handle None timestamps."""
        report = Report(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            sql_definition="SELECT 1",
            report_type="fact",
        )
        result = report.serialize()
        assert result["created_at"] is None
        assert result["updated_at"] is None


class TestReportFromRecord:
    """Tests for Report.from_record()."""

    def test_from_record_converts_correctly(self):
        """from_record should map all fields from a record-like object."""
        now = datetime.now(UTC)
        record = SimpleNamespace(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            description="desc",
            sql_definition="SELECT * FROM t",
            report_type="dimension",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            domain="Sales",
            columns_metadata=[{"name": "col1", "semantic_role": "entity", "semantic_type": "primary"}],
            materialization="table",
            created_at=now,
            updated_at=now,
        )
        report = Report.from_record(record)
        assert report.id == "report-1"
        assert report.project_id == "proj-1"
        assert report.org_id == "org-1"
        assert report.name == "My Report"
        assert report.description == "desc"
        assert report.sql_definition == "SELECT * FROM t"
        assert report.report_type == "dimension"
        assert report.source_refs == [{"id": "ds-1", "type": "dataset"}]
        assert report.domain == "Sales"
        assert report.columns_metadata == [{"name": "col1", "semantic_role": "entity", "semantic_type": "primary"}]
        assert report.materialization == "table"
        assert report.created_at == now
        assert report.updated_at == now

    def test_from_record_handles_none_source_refs(self):
        """from_record should default None source_refs to empty list."""
        record = SimpleNamespace(
            id="report-1",
            project_id="proj-1",
            org_id="org-1",
            name="My Report",
            description=None,
            sql_definition="SELECT 1",
            report_type="fact",
            source_refs=None,
            domain="Organization",
            columns_metadata=None,
            materialization="view",
            created_at=None,
            updated_at=None,
        )
        report = Report.from_record(record)
        assert report.source_refs == []
        assert report.columns_metadata == []
