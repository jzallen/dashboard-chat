"""Tests for the Source domain model."""

from datetime import UTC, datetime
from types import SimpleNamespace

from app.models.source import Source


class TestSourceConstruction:
    """Source dataclass construction and defaults."""

    def test_create_source_with_required_fields(self):
        """Source should be constructable with id + project_id, applying defaults."""
        source = Source(id="src-1", project_id="proj-1")

        assert source.id == "src-1"
        assert source.project_id == "proj-1"
        assert source.name == "New Source"
        assert source.schema_config == {}
        assert source.created_by is None
        assert source.created_at is None
        assert source.updated_at is None

    def test_create_source_with_all_fields(self):
        """Source should accept name, schema_config, created_by, timestamps."""
        now = datetime.now(UTC)
        schema = {"fields": {"patient_id": {"type": "text"}}}
        source = Source(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config=schema,
            created_by="user-1",
            created_at=now,
            updated_at=now,
        )

        assert source.name == "Patients"
        assert source.schema_config == schema
        assert source.created_by == "user-1"
        assert source.created_at == now
        assert source.updated_at == now


class TestSourceFromRecord:
    """Source.from_record coerces an ORM-shaped record into the domain model."""

    def test_from_record_maps_orm_fields(self):
        """from_record should copy fields and default a None schema_config to {}."""
        now = datetime.now(UTC)
        record = SimpleNamespace(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config=None,
            created_by="user-1",
            created_at=now,
            updated_at=now,
        )

        source = Source.from_record(record)

        assert source.id == "src-1"
        assert source.project_id == "proj-1"
        assert source.name == "Patients"
        assert source.schema_config == {}
        assert source.created_by == "user-1"
        assert source.created_at == now
        assert source.updated_at == now


class TestSourceSerialize:
    """Source.serialize produces the wire-facing dict."""

    def test_serialize_emits_iso_timestamps(self):
        """serialize should return a JSON-shaped dict with ISO-8601 timestamps."""
        now = datetime(2026, 6, 11, 12, 0, 0, tzinfo=UTC)
        source = Source(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
            created_at=now,
            updated_at=now,
        )

        assert source.serialize() == {
            "id": "src-1",
            "project_id": "proj-1",
            "name": "Patients",
            "schema_config": {"fields": {}},
            "created_by": "user-1",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "archived_at": None,
            "retention_until": None,
        }

    def test_serialize_handles_none_timestamps(self):
        """serialize should pass through None timestamps without error."""
        source = Source(id="src-1", project_id="proj-1")

        serialized = source.serialize()

        assert serialized["created_at"] is None
        assert serialized["updated_at"] is None
        assert serialized["archived_at"] is None
        assert serialized["retention_until"] is None


class TestSourceColdStorageFields:
    """Cold-storage lifecycle fields (archived_at, retention_until) on the wire."""

    def test_serialize_carries_cold_storage_timestamps(self):
        """An archived source serializes both lifecycle fields as ISO-8601 strings."""
        archived_at = datetime(2026, 7, 22, 12, 0, 0, tzinfo=UTC)
        retention_until = datetime(2026, 10, 20, 12, 0, 0, tzinfo=UTC)
        source = Source(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
            created_at=archived_at,
            updated_at=archived_at,
            archived_at=archived_at,
            retention_until=retention_until,
        )

        assert source.serialize() == {
            "id": "src-1",
            "project_id": "proj-1",
            "name": "Patients",
            "schema_config": {"fields": {}},
            "created_by": "user-1",
            "created_at": "2026-07-22T12:00:00+00:00",
            "updated_at": "2026-07-22T12:00:00+00:00",
            "archived_at": "2026-07-22T12:00:00+00:00",
            "retention_until": "2026-10-20T12:00:00+00:00",
        }

    def test_from_record_maps_cold_storage_fields(self):
        """from_record hydrates the cold-storage fields off the ORM record."""
        archived_at = datetime(2026, 7, 22, 12, 0, 0, tzinfo=UTC)
        retention_until = datetime(2026, 10, 20, 12, 0, 0, tzinfo=UTC)
        record = SimpleNamespace(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
            created_at=archived_at,
            updated_at=archived_at,
            archived_at=archived_at,
            retention_until=retention_until,
        )

        assert Source.from_record(record) == Source(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
            created_at=archived_at,
            updated_at=archived_at,
            archived_at=archived_at,
            retention_until=retention_until,
        )

    def test_from_record_defaults_cold_storage_fields_to_none(self):
        """A live source (record without the fields) hydrates them as None."""
        record = SimpleNamespace(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
            created_at=None,
            updated_at=None,
        )

        assert Source.from_record(record) == Source(
            id="src-1",
            project_id="proj-1",
            name="Patients",
            schema_config={"fields": {}},
            created_by="user-1",
        )
