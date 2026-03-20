"""Tests for View domain model."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.models.view import View


class TestViewConstruction:
    """Tests for View dataclass construction."""

    def test_create_view_with_required_fields(self):
        """View should be constructable with required fields only."""
        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            sql_definition="SELECT * FROM source",
        )
        assert view.id == "view-1"
        assert view.project_id == "proj-1"
        assert view.org_id == "org-1"
        assert view.name == "My View"
        assert view.sql_definition == "SELECT * FROM source"
        assert view.source_refs == []
        assert view.description is None
        assert view.materialization == "ephemeral"
        assert view.created_at is None
        assert view.updated_at is None

    def test_create_view_with_all_fields(self):
        """View should accept all optional fields."""
        now = datetime.now(UTC)
        refs = [{"id": "ds-1", "type": "dataset"}]
        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            sql_definition="SELECT * FROM source",
            source_refs=refs,
            description="A test view",
            materialization="table",
            created_at=now,
            updated_at=now,
        )
        assert view.source_refs == refs
        assert view.description == "A test view"
        assert view.materialization == "table"
        assert view.created_at == now
        assert view.updated_at == now

    def test_view_is_frozen(self):
        """View should be immutable (frozen dataclass)."""
        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            sql_definition="SELECT 1",
        )
        with pytest.raises(AttributeError):
            view.name = "Changed"


class TestViewSerialization:
    """Tests for View.serialize()."""

    def test_serialize_with_timestamps(self):
        """serialize should include ISO-formatted timestamps."""
        now = datetime(2026, 3, 6, 12, 0, 0)
        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            sql_definition="SELECT * FROM source",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            description="A test",
            materialization="ephemeral",
            created_at=now,
            updated_at=now,
        )
        result = view.serialize()
        assert result["id"] == "view-1"
        assert result["project_id"] == "proj-1"
        assert result["org_id"] == "org-1"
        assert result["name"] == "My View"
        assert result["sql_definition"] == "SELECT * FROM source"
        assert result["source_refs"] == [{"id": "ds-1", "type": "dataset"}]
        assert result["description"] == "A test"
        assert result["materialization"] == "ephemeral"
        assert result["created_at"] == "2026-03-06T12:00:00"
        assert result["updated_at"] == "2026-03-06T12:00:00"

    def test_serialize_with_none_timestamps(self):
        """serialize should handle None timestamps."""
        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            sql_definition="SELECT 1",
        )
        result = view.serialize()
        assert result["created_at"] is None
        assert result["updated_at"] is None


class TestViewFromRecord:
    """Tests for View.from_record()."""

    def test_from_record_converts_correctly(self):
        """from_record should map all fields from a record-like object."""
        now = datetime.now(UTC)
        record = SimpleNamespace(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            description="desc",
            sql_definition="SELECT * FROM t",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            columns=[],
            joins=[],
            filters=[],
            grain=None,
            materialization="view",
            created_at=now,
            updated_at=now,
        )
        view = View.from_record(record)
        assert view.id == "view-1"
        assert view.project_id == "proj-1"
        assert view.org_id == "org-1"
        assert view.name == "My View"
        assert view.description == "desc"
        assert view.sql_definition == "SELECT * FROM t"
        assert view.source_refs == [{"id": "ds-1", "type": "dataset"}]
        assert view.materialization == "view"
        assert view.created_at == now
        assert view.updated_at == now

    def test_from_record_handles_none_source_refs(self):
        """from_record should default None source_refs to empty list."""
        record = SimpleNamespace(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="My View",
            description=None,
            sql_definition="SELECT 1",
            source_refs=None,
            columns=[],
            joins=[],
            filters=[],
            grain=None,
            materialization="ephemeral",
            created_at=None,
            updated_at=None,
        )
        view = View.from_record(record)
        assert view.source_refs == []
