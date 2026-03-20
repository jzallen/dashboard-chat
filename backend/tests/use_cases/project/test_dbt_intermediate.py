"""Tests for dbt export intermediate model generation with views."""

import zipfile
from io import BytesIO

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.view import DisplayType, View, ViewColumn
from app.use_cases.project._dbt import generate_dbt_project_zip


def _make_project(datasets=None):
    return Project(
        id="proj-1",
        name="Test Project",
        datasets=datasets or [],
    )


def _make_dataset(ds_id="ds1", name="orders"):
    return Dataset(
        id=ds_id,
        project_id="proj-1",
        name=name,
        schema_config={"fields": {"id": {"type": "text"}}},
    )


def _make_view_with_columns(view_id="v1", name="enriched", source_refs=None, columns=None):
    return View(
        id=view_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition="SELECT * FROM orders",
        source_refs=source_refs or [{"id": "ds1", "type": "dataset", "name": "orders"}],
        columns=columns
        or [
            ViewColumn(
                name="order_id",
                source_ref="ds1",
                source_column="id",
                display_type=DisplayType.text,
            )
        ],
    )


def _make_legacy_view(view_id="v1", name="enriched", source_refs=None):
    return View(
        id=view_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition="SELECT * FROM ds1",
        source_refs=source_refs or [{"id": "ds1", "type": "dataset", "name": "orders"}],
    )


class TestDbtIntermediateGeneration:
    def test_intermediate_file_path_correct(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])
        view = _make_legacy_view()

        zip_bytes = generate_dbt_project_zip(project, "test_project", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())
        assert "models/intermediate/int_enriched.sql" in names

    def test_ref_macros_resolved_legacy(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])
        view = _make_legacy_view()

        zip_bytes = generate_dbt_project_zip(project, "test_project", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        sql = zf.read("models/intermediate/int_enriched.sql").decode("utf-8")
        assert "{{ ref('stg_orders') }}" in sql

    def test_materialization_header_present(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])
        view = _make_legacy_view()

        zip_bytes = generate_dbt_project_zip(project, "test_project", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        sql = zf.read("models/intermediate/int_enriched.sql").decode("utf-8")
        assert "{{ config(materialized='ephemeral') }}" in sql

    def test_no_views_no_intermediate_directory(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test_project", views=[])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        intermediate_files = [n for n in zf.namelist() if "intermediate" in n]
        assert intermediate_files == []

    def test_structured_view_uses_sql_generator(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])
        view = _make_view_with_columns()

        zip_bytes = generate_dbt_project_zip(project, "test_project", views=[view])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        sql = zf.read("models/intermediate/int_enriched.sql").decode("utf-8")
        # Should use ref_mode=True, generating ref() calls
        assert "{{ ref('stg_orders') }}" in sql
        # Should have CAST from the SQL generator
        assert "CAST" in sql

    def test_staging_only_when_no_views(self):
        ds = _make_dataset()
        project = _make_project(datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())
        assert "models/staging/stg_orders.sql" in names
        intermediate_files = [n for n in names if "intermediate" in n]
        assert intermediate_files == []
