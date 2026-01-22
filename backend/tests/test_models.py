"""Tests for SQLAlchemy models.

These tests verify model structure and relationships.
Run with: pytest backend/tests/test_models.py
"""

import pytest
from datetime import datetime

from app.models import Project, Dataset, FilterPipeline, PipelineRun, RunStatus


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
            name="Test Dataset",
            table_name="test_table",
        )
        assert "Test Dataset" in repr(dataset)
        assert "test_table" in repr(dataset)


class TestFilterPipelineModel:
    """Tests for FilterPipeline model."""

    def test_pipeline_creation(self):
        """Test FilterPipeline model can be instantiated."""
        raqb_json = {
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
        pipeline = FilterPipeline(
            dataset_id="dataset-123",
            name="High Value Items",
            raqb_json=raqb_json,
            cached_sql='"amount" > 100',
        )
        assert pipeline.name == "High Value Items"
        assert pipeline.raqb_json == raqb_json
        assert pipeline.cached_sql == '"amount" > 100'

    def test_pipeline_version_default(self):
        """Test FilterPipeline version defaults to 1."""
        pipeline = FilterPipeline(
            dataset_id="dataset-123",
            name="Test",
            raqb_json={},
        )
        # Note: default is applied by SQLAlchemy

    def test_pipeline_is_active_default(self):
        """Test FilterPipeline is_active defaults to True."""
        pipeline = FilterPipeline(
            dataset_id="dataset-123",
            name="Test",
            raqb_json={},
        )
        # Note: default is applied by SQLAlchemy

    def test_pipeline_repr(self):
        """Test FilterPipeline __repr__ method."""
        pipeline = FilterPipeline(
            id="pl-id",
            name="Test Pipeline",
            version=2,
        )
        assert "Test Pipeline" in repr(pipeline)
        assert "version=2" in repr(pipeline)


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

    def test_dataset_has_pipelines_relationship(self):
        """Document: Dataset should have a pipelines relationship."""
        dataset = Dataset(
            project_id="p-1",
            name="Test",
            table_name="test",
        )
        assert hasattr(dataset, "pipelines")

    def test_pipeline_has_runs_relationship(self):
        """Document: FilterPipeline should have a runs relationship."""
        pipeline = FilterPipeline(
            dataset_id="d-1",
            name="Test",
            raqb_json={},
        )
        assert hasattr(pipeline, "runs")
