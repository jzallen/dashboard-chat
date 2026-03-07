"""Tests for intermediate model generation within the zip orchestrator."""

import zipfile
from io import BytesIO

import pytest

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.view import View
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project.exceptions import ExportValidationError


def _make_project(name: str, datasets: list[Dataset] | None = None) -> Project:
    return Project(id="proj-1", name=name, datasets=datasets or [])


def _make_dataset(
    ds_id: str = "ds-1",
    name: str = "Test Dataset",
    schema_config: dict | None = None,
) -> Dataset:
    return Dataset(
        id=ds_id,
        project_id="proj-1",
        name=name,
        schema_config=schema_config or {"fields": {"col_a": {"type": "text"}}},
        transforms=[],
    )


def _make_view(
    view_id: str = "view-1",
    name: str = "Enriched Orders",
    sql_definition: str = "SELECT * FROM ds-1",
    source_refs: list[dict] | None = None,
    materialization: str = "ephemeral",
) -> View:
    return View(
        id=view_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition=sql_definition,
        source_refs=source_refs or [],
        materialization=materialization,
    )


class TestZipWithViews:
    def test_zip_contains_intermediate_model_files(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        view = _make_view(
            view_id="view-1",
            name="Enriched Orders",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        project = _make_project("Sales", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "sales", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/intermediate/int_enriched_orders.sql" in names

    def test_intermediate_sql_has_config_and_ref(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        view = _make_view(
            view_id="view-1",
            name="Clean Orders",
            sql_definition="SELECT * FROM ds-1 WHERE active = true",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="view",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        sql = zf.read("models/intermediate/int_clean_orders.sql").decode("utf-8")
        assert "{{ config(materialized='view') }}" in sql
        assert "{{ ref('stg_orders') }}" in sql
        assert "ds-1" not in sql

    def test_view_referencing_another_view(self):
        ds = _make_dataset(ds_id="ds-1", name="Raw")
        view1 = _make_view(
            view_id="view-1",
            name="Stage One",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        view2 = _make_view(
            view_id="view-2",
            name="Stage Two",
            sql_definition="SELECT * FROM view-1",
            source_refs=[{"id": "view-1", "type": "view"}],
        )
        project = _make_project("Pipeline", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(
            project, "pipeline", views=[view1, view2]
        )
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        sql2 = zf.read("models/intermediate/int_stage_two.sql").decode("utf-8")
        assert "{{ ref('int_stage_one') }}" in sql2

    def test_duplicate_view_names_deduplicated(self):
        ds = _make_dataset(ds_id="ds-1", name="Data")
        view1 = _make_view(
            view_id="view-1",
            name="Summary",
            sql_definition="SELECT 1",
            source_refs=[],
        )
        view2 = _make_view(
            view_id="view-2",
            name="Summary",
            sql_definition="SELECT 2",
            source_refs=[],
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(
            project, "test", views=[view1, view2]
        )
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/intermediate/int_summary.sql" in names
        assert "models/intermediate/int_summary_1.sql" in names

    def test_no_views_produces_no_intermediate_dir(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", views=[])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        int_files = [n for n in names if "intermediate" in n]
        assert int_files == []

    def test_zip_still_contains_staging_files_with_views(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        view = _make_view(
            view_id="view-1",
            name="V1",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/staging/stg_orders.sql" in names
        assert "models/intermediate/int_v1.sql" in names


class TestBrokenReferenceDetection:
    def test_broken_ref_raises_export_validation_error(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        view = _make_view(
            view_id="view-1",
            name="Bad View",
            sql_definition="SELECT * FROM deleted-id",
            source_refs=[{"id": "deleted-id", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[ds])

        with pytest.raises(ExportValidationError, match="deleted entity"):
            generate_dbt_project_zip(project, "test", views=[view])

    def test_broken_ref_error_includes_view_name(self):
        view = _make_view(
            view_id="view-1",
            name="My Broken View",
            sql_definition="SELECT * FROM gone-id",
            source_refs=[{"id": "gone-id", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[])

        with pytest.raises(ExportValidationError, match="My Broken View"):
            generate_dbt_project_zip(project, "test", views=[view])

    def test_broken_ref_error_includes_missing_id(self):
        view = _make_view(
            view_id="view-1",
            name="V1",
            sql_definition="SELECT * FROM missing-abc",
            source_refs=[{"id": "missing-abc", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[])

        with pytest.raises(ExportValidationError, match="missing-abc"):
            generate_dbt_project_zip(project, "test", views=[view])

    def test_valid_refs_do_not_raise(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        view = _make_view(
            view_id="view-1",
            name="V1",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[ds])

        # Should not raise
        zip_bytes = generate_dbt_project_zip(project, "test", views=[view])
        assert isinstance(zip_bytes, bytes)
