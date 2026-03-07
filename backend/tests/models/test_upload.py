"""Tests for Upload domain model."""

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.models.upload import Upload


class TestUploadConstruction:
    """Tests for Upload dataclass construction."""

    def test_create_upload_with_required_fields(self):
        upload = Upload(
            id="upload-1",
            project_id="proj-1",
            raw_storage_path="s3://bucket/raw/file.csv",
            original_filename="data.csv",
            file_size=1024,
        )
        assert upload.id == "upload-1"
        assert upload.project_id == "proj-1"
        assert upload.raw_storage_path == "s3://bucket/raw/file.csv"
        assert upload.original_filename == "data.csv"
        assert upload.file_size == 1024
        assert upload.row_count == 0
        assert upload.dataset_id is None
        assert upload.dataset_ids == []
        assert upload.converted_storage_path is None
        assert upload.status == "pending"
        assert upload.error_message is None
        assert upload.created_at is None
        assert upload.processed_at is None
        assert upload.preview_rows == []
        assert upload.choices is None

    def test_create_upload_with_new_fields(self):
        upload = Upload(
            id="upload-1",
            project_id="proj-1",
            raw_storage_path="s3://bucket/raw/file.hl7",
            original_filename="messages.hl7",
            file_size=2048,
            dataset_id="ds-1",
            dataset_ids=["ds-1", "ds-2", "ds-3"],
            converted_storage_path="s3://bucket/converted/file.parquet",
        )
        assert upload.dataset_id == "ds-1"
        assert upload.dataset_ids == ["ds-1", "ds-2", "ds-3"]
        assert upload.converted_storage_path == "s3://bucket/converted/file.parquet"

    def test_upload_is_frozen(self):
        upload = Upload(
            id="upload-1",
            project_id="proj-1",
            raw_storage_path="s3://bucket/raw/file.csv",
            original_filename="data.csv",
            file_size=1024,
        )
        with pytest.raises(AttributeError):
            upload.status = "completed"


class TestUploadSerialization:
    """Tests for Upload.serialize()."""

    def test_serialize_includes_new_fields(self):
        now = datetime(2026, 3, 7, 12, 0, 0)
        upload = Upload(
            id="upload-1",
            project_id="proj-1",
            raw_storage_path="s3://bucket/raw/file.hl7",
            original_filename="messages.hl7",
            file_size=2048,
            dataset_id="ds-1",
            dataset_ids=["ds-1", "ds-2"],
            converted_storage_path="s3://bucket/converted/file.parquet",
            status="completed",
            row_count=100,
            created_at=now,
            processed_at=now,
        )
        result = upload.serialize()
        assert result["id"] == "upload-1"
        assert result["project_id"] == "proj-1"
        assert result["dataset_id"] == "ds-1"
        assert result["dataset_ids"] == ["ds-1", "ds-2"]
        assert result["converted_storage_path"] == "s3://bucket/converted/file.parquet"
        assert result["status"] == "completed"
        assert result["row_count"] == 100
        assert result["created_at"] == "2026-03-07T12:00:00"
        assert result["processed_at"] == "2026-03-07T12:00:00"

    def test_serialize_defaults(self):
        upload = Upload(
            id="upload-1",
            project_id="proj-1",
            raw_storage_path="s3://bucket/raw/file.csv",
            original_filename="data.csv",
            file_size=1024,
        )
        result = upload.serialize()
        assert result["dataset_id"] is None
        assert result["dataset_ids"] == []
        assert result["converted_storage_path"] is None
        assert result["created_at"] is None
        assert result["processed_at"] is None


class TestUploadFromOutboxRecord:
    """Tests for Upload.from_outbox_record()."""

    def test_from_outbox_record_with_new_fields(self):
        now = datetime(2026, 3, 7, 12, 0, 0)
        record = SimpleNamespace(
            id="upload-1",
            created_at=now,
            payload={
                "project_id": "proj-1",
                "dataset_id": "ds-1",
                "dataset_ids": ["ds-1", "ds-2"],
                "converted_storage_path": "s3://bucket/converted/file.parquet",
                "raw_storage_path": "s3://bucket/raw/file.hl7",
                "original_filename": "messages.hl7",
                "file_size": 2048,
            },
        )
        upload = Upload.from_outbox_record(record)
        assert upload.dataset_id == "ds-1"
        assert upload.dataset_ids == ["ds-1", "ds-2"]
        assert upload.converted_storage_path == "s3://bucket/converted/file.parquet"

    def test_from_outbox_record_backward_compat(self):
        """Old outbox records without new fields should still work."""
        now = datetime(2026, 3, 7, 12, 0, 0)
        record = SimpleNamespace(
            id="upload-1",
            created_at=now,
            payload={
                "project_id": "proj-1",
                "dataset_id": "ds-1",
                "raw_storage_path": "s3://bucket/raw/file.csv",
                "original_filename": "data.csv",
                "file_size": 1024,
            },
        )
        upload = Upload.from_outbox_record(record)
        assert upload.dataset_id == "ds-1"
        assert upload.dataset_ids == []
        assert upload.converted_storage_path is None

    def test_from_outbox_record_with_preview_rows(self):
        record = SimpleNamespace(
            id="upload-1",
            created_at=datetime(2026, 3, 7, 12, 0, 0),
            payload={
                "project_id": "proj-1",
                "dataset_id": None,
                "raw_storage_path": "s3://bucket/raw/file.csv",
                "original_filename": "data.csv",
                "file_size": 512,
            },
        )
        rows = [{"col1": "val1"}, {"col1": "val2"}]
        upload = Upload.from_outbox_record(record, preview_rows=rows)
        assert upload.preview_rows == rows
        assert upload.dataset_id is None
