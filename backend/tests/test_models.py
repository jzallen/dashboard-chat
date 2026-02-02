"""Tests for domain models.

These tests verify model structure and behavior.
Run with: pytest backend/tests/test_models.py
"""

import pytest
from datetime import datetime

from app.models import Project, Dataset, Transform, PipelineRun, RunStatus


class TestProjectModel:
    """Tests for Project domain model."""

    def test_project_creation(self):
        """Test Project model can be instantiated."""
        project = Project(
            id="test-id",
            name="Test Project",
            description="A test project",
        )
        assert project.name == "Test Project"
        assert project.description == "A test project"

    def test_project_repr(self):
        """Test Project __repr__ method."""
        project = Project(id="test-id", name="Test Project")
        assert "Test Project" in repr(project)
        assert "test-id" in repr(project)


class TestDatasetModel:
    """Tests for Dataset domain model."""

    def test_dataset_creation(self):
        """Test Dataset model can be instantiated."""
        dataset = Dataset(
            id="ds-id",
            project_id="project-123",
            storage_path="project-123/ds-id.parquet",
            name="Test Dataset",
            schema_config={"fields": {}},
        )
        assert dataset.name == "Test Dataset"
        assert dataset.storage_path == "project-123/ds-id.parquet"

    def test_dataset_schema_config_default(self):
        """Test Dataset schema_config defaults to empty dict."""
        dataset = Dataset(
            id="ds-id",
            project_id="project-123",
            storage_path="project-123/ds-id.parquet",
            name="Test",
        )
        assert dataset.schema_config == {}

    def test_dataset_partition_fields_default(self):
        """Test Dataset partition_fields defaults to empty list."""
        dataset = Dataset(
            id="ds-id",
            project_id="project-123",
            storage_path="datasets/project-123/ds-id/",
            name="Test",
        )
        assert dataset.partition_fields == []

    def test_dataset_repr(self):
        """Test Dataset __repr__ method."""
        dataset = Dataset(
            id="ds-id",
            storage_path="project-1/ds-id.parquet",
            name="Test Dataset",
            schema_config={},
            transforms=[],
        )
        assert "Test Dataset" in repr(dataset)
        assert "ds-id" in repr(dataset)


class TestTransformModel:
    """Tests for Transform domain model."""

    def test_transform_creation(self):
        """Test Transform model can be instantiated."""
        condition_json = {
            "type": "group",
            "properties": {"conjunction": "AND"},
            "children1": {
                "rule1": {
                    "type": "rule",
                    "properties": {
                        "field": "amount",
                        "operator": "greater",
                        "value": [100],
                    },
                },
            },
        }
        transform = Transform(
            id="transform-123",
            name="High Value Items",
            condition_json=condition_json,
            condition_sql='"amount" > 100',
        )
        assert transform.name == "High Value Items"
        assert transform.condition_json == condition_json
        assert transform.condition_sql == '"amount" > 100'

    def test_transform_status_default(self):
        """Test Transform status defaults to 'enabled'."""
        transform = Transform(
            id="transform-123",
            name="Test",
            condition_json={},
        )
        assert transform.status == "enabled"

    def test_transform_repr(self):
        """Test Transform __repr__ method."""
        transform = Transform(
            id="pl-id",
            name="Test Transform",
            condition_json={},
        )
        assert "Test Transform" in repr(transform)
        assert "pl-id" in repr(transform)


class TestPipelineRunModel:
    """Tests for PipelineRun model."""

    def test_pipeline_run_creation(self):
        """Test PipelineRun model can be instantiated."""
        run = PipelineRun(
            pipeline_id="pipeline-123",
            status="completed",
            input_row_count=1000,
            output_row_count=250,
            execution_time_ms=45.5,
        )
        assert run.status == "completed"
        assert run.input_row_count == 1000
        assert run.output_row_count == 250
        assert run.execution_time_ms == 45.5

    def test_run_status_constants(self):
        """Test RunStatus constants are defined."""
        assert RunStatus.PENDING == "pending"
        assert RunStatus.RUNNING == "running"
        assert RunStatus.COMPLETED == "completed"
        assert RunStatus.FAILED == "failed"

    def test_pipeline_run_repr(self):
        """Test PipelineRun __repr__ method."""
        run = PipelineRun(id="run-id", status="completed")
        assert "run-id" in repr(run)
        assert "completed" in repr(run)


class TestDomainModelAttributes:
    """Tests for domain model attributes (documentation purposes)."""

    def test_dataset_has_transforms_attribute(self):
        """Document: Dataset should have a transforms attribute."""
        dataset = Dataset(
            id="ds-id",
            project_id="p-1",
            storage_path="p-1/ds-id.parquet",
            name="Test",
        )
        assert hasattr(dataset, "transforms")
        assert dataset.transforms == []

    def test_dataset_has_preview_rows_attribute(self):
        """Document: Dataset should have a preview_rows attribute."""
        dataset = Dataset(
            id="ds-id",
            project_id="p-1",
            storage_path="p-1/ds-id.parquet",
            name="Test",
        )
        assert hasattr(dataset, "preview_rows")
        assert dataset.preview_rows == []

    def test_transform_has_is_enabled_property(self):
        """Document: Transform should have an is_enabled property."""
        transform = Transform(
            id="t-1",
            name="Test",
            condition_json={},
            status="enabled",
        )
        assert hasattr(transform, "is_enabled")
        assert transform.is_enabled is True

        transform_disabled = Transform(
            id="t-2",
            name="Test Disabled",
            condition_json={},
            status="disabled",
        )
        assert transform_disabled.is_enabled is False
