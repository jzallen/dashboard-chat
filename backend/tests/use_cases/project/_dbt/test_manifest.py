"""Tests for the pure dbt file-plan builder (shared source of truth with the zip)."""

import zipfile
from io import BytesIO

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.report import Report
from app.models.view import View
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project._dbt.manifest import build_dbt_file_plan


def _dataset(ds_id: str, name: str, model_name: str | None = None) -> Dataset:
    return Dataset(
        id=ds_id,
        name=name,
        schema_config={"fields": {"name": {"type": "text"}}},
        model_name=model_name,
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


class TestModelNameRepointsEject:
    """Slice C: a user-set ``model_name`` repoints the dbt eject's staging
    source name, the ``.sql`` filename, and the ``ref`` target in lockstep so an
    ejected project matches the live warehouse view."""

    def test_staging_path_and_ref_use_model_name_when_set(self):
        project = Project(
            id="p1",
            name="Acme Analytics",
            description=None,
            datasets=[_dataset("d1", "Leads.csv", model_name="stg_warm_leads")],
        )

        entries = build_dbt_file_plan(project)
        by_path = {e["path"]: e for e in entries}

        assert "models/staging/stg_warm_leads.sql" in by_path
        assert by_path["models/staging/stg_warm_leads.sql"]["ref"] == "stg_warm_leads"
        # the legacy filename-derived path must NOT be emitted
        assert "models/staging/stg_leads.sql" not in by_path

    def test_staging_path_falls_back_to_snake_name_when_model_name_null(self):
        project = Project(
            id="p1",
            name="Acme Analytics",
            description=None,
            datasets=[_dataset("d1", "Leads", model_name=None)],
        )

        entries = build_dbt_file_plan(project)
        by_path = {e["path"]: e for e in entries}

        assert "models/staging/stg_leads.sql" in by_path

    def test_ejected_sql_filename_and_source_ref_agree_with_model_name(self):
        """The staging ``.sql`` file binds to a source whose name matches the
        warehouse view (``model_name``); filename stem and ref agree."""
        project = Project(
            id="p1",
            name="Acme Analytics",
            description=None,
            datasets=[_dataset("d1", "Leads.csv", model_name="stg_warm_leads")],
        )

        zip_bytes = generate_dbt_project_zip(project, "acme_analytics")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        # filename uses the resolved (model_name) staging name
        assert "models/staging/stg_warm_leads.sql" in zf.namelist()

        staging_sql = zf.read("models/staging/stg_warm_leads.sql").decode()
        sources_yml = zf.read("models/staging/sources.yml").decode()

        # the staging model selects from a source named for the warehouse view,
        # and sources.yml declares exactly that source name — they agree.
        assert "stg_warm_leads" in staging_sql
        assert "name: stg_warm_leads" in sources_yml

    def test_manifest_and_zip_still_agree_with_model_name_set(self):
        project = Project(
            id="p1",
            name="Acme Analytics",
            description=None,
            datasets=[_dataset("d1", "Leads.csv", model_name="stg_warm_leads")],
        )

        plan_paths = sorted(e["path"] for e in build_dbt_file_plan(project))
        zip_paths = sorted(zipfile.ZipFile(BytesIO(generate_dbt_project_zip(project, "acme_analytics"))).namelist())

        assert plan_paths == zip_paths
