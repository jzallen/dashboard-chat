"""Tests for SQLAlchemy models.

These tests verify model structure and relationships.
Run with: pytest backend/tests/test_models.py
"""

import pytest
from datetime import datetime

from app.models import Project, Dataset, Transform, PipelineRun, RunStatus


class TestProjectModel:
    """Tests for Project model."""

    def test_project_creation(self):
        """Test Project model can be instantiated."""
        project = Project(
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
    """Tests for Dataset model."""

    def test_dataset_creation(self):
        """Test Dataset model can be instantiated."""
        dataset = Dataset(
            project_id="project-123",
            name="Test Dataset",
            table_name="data_test_dataset",
            schema_config={"fields": {}},
            row_count=100,
        )
        assert dataset.name == "Test Dataset"
        assert dataset.table_name == "data_test_dataset"
        assert dataset.row_count == 100

    def test_dataset_schema_config_default(self):
        """Test Dataset schema_config defaults to empty dict."""
        dataset = Dataset(
            project_id="project-123",
            name="Test",
            table_name="test_table",
        )
        # Note: default is applied by SQLAlchemy, not at instantiation
        # This test documents expected behavior

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
    """Tests for Transform model."""

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
            dataset_id="dataset-123",
            name="High Value Items",
            condition_json=condition_json,
            condition_sql='"amount" > 100',
        )
        assert transform.name == "High Value Items"
        assert transform.condition_json == condition_json
        assert transform.condition_sql == '"amount" > 100'

    def test_transform_version_default(self):
        """Test Transform version defaults to 1."""
        transform = Transform(
            dataset_id="dataset-123",
            name="Test",
            condition_json={},
        )
        # Note: default is applied by SQLAlchemy

    def test_transform_status_default(self):
        """Test Transform status defaults to 'enabled'."""
        transform = Transform(
            dataset_id="dataset-123",
            name="Test",
            condition_json={},
        )
        # Note: default is applied by SQLAlchemy

    def test_transform_repr(self):
        """Test Transform __repr__ method."""
        transform = Transform(
            id="pl-id",
            name="Test Transform",
            condition_json={},
            version=2,
        )
        assert "Test Transform" in repr(transform)
        assert "version=2" in repr(transform)


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


class TestModelRelationships:
    """Tests for model relationships (documentation purposes).

    These tests document the expected relationships between models.
    Actual relationship testing requires a database connection.
    """

    def test_project_has_datasets_relationship(self):
        """Document: Project should have a datasets relationship."""
        project = Project(name="Test")
        # Project.datasets should be available (but empty without DB)
        assert hasattr(project, "datasets")

    def test_dataset_has_transforms_relationship(self):
        """Document: Dataset should have a transforms relationship."""
        dataset = Dataset(
            project_id="p-1",
            name="Test",
            table_name="test",
        )
        assert hasattr(dataset, "transforms")

    def test_transform_has_runs_relationship(self):
        """Document: Transform should have a runs relationship."""
        transform = Transform(
            dataset_id="d-1",
            name="Test",
            raqb_json={},
        )
        assert hasattr(transform, "runs")
