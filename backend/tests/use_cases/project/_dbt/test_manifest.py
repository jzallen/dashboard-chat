"""Tests for the pure dbt file-plan builder (shared source of truth with the zip)."""

import zipfile
from io import BytesIO

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.report import Report
from app.models.view import View
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project._dbt.manifest import build_dbt_file_plan


def _dataset(ds_id: str, name: str) -> Dataset:
    return Dataset(
        id=ds_id,
        name=name,
        schema_config={"fields": {"name": {"type": "text"}}},
    )


def _view(view_id: str, name: str, source_id: str) -> View:
    return View(
        id=view_id,
        project_id="p1",
        org_id="o1",
        name=name,
        sql_definition="SELECT 1",
        source_refs=[{"id": source_id, "type": "dataset"}],
    )


def _report(report_id: str, name: str, source_id: str, report_type: str = "fact") -> Report:
    return Report(
        id=report_id,
        project_id="p1",
        org_id="o1",
        name=name,
        domain="sales",
        report_type=report_type,
        sql_definition="SELECT 1",
        source_refs=[{"id": source_id, "type": "view"}],
    )


def _project() -> Project:
    return Project(
        id="p1",
        name="Acme Analytics",
        description=None,
        datasets=[_dataset("d1", "Leads")],
    )


class TestBuildDbtFilePlan:
    def test_classifies_staging_intermediate_mart_and_config_layers(self):
        project = _project()
        views = [_view("v1", "Active", "d1")]
        reports = [_report("r1", "Revenue", "v1")]

        entries = build_dbt_file_plan(project, views=views, reports=reports)
        by_path = {e["path"]: e for e in entries}

        # staging model from the dataset
        assert by_path["models/staging/stg_leads.sql"]["layer"] == "staging"
        assert by_path["models/staging/stg_leads.sql"]["ref"] == "stg_leads"

        # intermediate model from the view
        assert by_path["models/intermediate/int_active.sql"]["layer"] == "intermediate"
        assert by_path["models/intermediate/int_active.sql"]["ref"] == "int_active"

        # mart model from the fact report (fct_ prefix, domain subfolder)
        assert by_path["models/marts/sales/fct_revenue.sql"]["layer"] == "mart"
        assert by_path["models/marts/sales/fct_revenue.sql"]["ref"] == "fct_revenue"

        # config (non-model) files
        assert by_path["dbt_project.yml"]["layer"] == "config"
        assert by_path["profiles.yml"]["layer"] == "config"
        assert by_path["models/staging/sources.yml"]["layer"] == "config"

    def test_dim_report_uses_dim_prefix(self):
        project = _project()
        reports = [_report("r1", "Customer", "d1", report_type="dimension")]

        entries = build_dbt_file_plan(project, views=[], reports=reports)
        by_path = {e["path"]: e for e in entries}

        assert "models/marts/sales/dim_customer.sql" in by_path
        assert by_path["models/marts/sales/dim_customer.sql"]["ref"] == "dim_customer"

    def test_file_plan_paths_equal_zip_contents(self):
        """The manifest's file list MUST match the zip's actual entries (shared SSOT)."""
        project = _project()
        views = [_view("v1", "Active", "d1")]
        reports = [_report("r1", "Revenue", "v1")]

        entries = build_dbt_file_plan(project, views=views, reports=reports)
        plan_paths = sorted(e["path"] for e in entries)

        zip_bytes = generate_dbt_project_zip(project, "acme_analytics", views=views, reports=reports)
        zip_paths = sorted(zipfile.ZipFile(BytesIO(zip_bytes)).namelist())

        assert plan_paths == zip_paths
