"""Tests for mart model SQL generation."""

import zipfile
from io import BytesIO

import pytest

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.report import Report
from app.use_cases.project._dbt import generate_dbt_project_zip
from app.use_cases.project._dbt.marts import generate_mart_sql
from app.use_cases.project.exceptions import ExportValidationError


def _make_report(
    report_id: str = "rpt-1",
    name: str = "Monthly Sales",
    sql_definition: str = "SELECT * FROM ds-1",
    report_type: str = "fact",
    source_refs: list[dict] | None = None,
    materialization: str = "table",
    domain: str = "Sales",
    columns_metadata: list[dict] | None = None,
) -> Report:
    return Report(
        id=report_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition=sql_definition,
        report_type=report_type,
        source_refs=source_refs or [],
        materialization=materialization,
        domain=domain,
        columns_metadata=columns_metadata or [],
    )


def _make_dataset(
    ds_id: str = "ds-1",
    name: str = "Orders",
    schema_config: dict | None = None,
) -> Dataset:
    return Dataset(
        id=ds_id,
        project_id="proj-1",
        name=name,
        schema_config=schema_config or {"fields": {"col_a": {"type": "text"}}},
        transforms=[],
    )


def _make_project(name: str, datasets: list[Dataset] | None = None) -> Project:
    return Project(id="proj-1", name=name, datasets=datasets or [])


class TestGenerateMartSQL:
    def test_mart_sql_config_block(self):
        report = _make_report(
            materialization="table",
            source_refs=[],
            sql_definition="SELECT 1",
        )
        result = generate_mart_sql("monthly_sales", report, {})

        assert result.startswith("{{ config(materialized='table') }}")

    def test_mart_sql_config_block_view(self):
        report = _make_report(
            materialization="view",
            source_refs=[],
            sql_definition="SELECT 1",
        )
        result = generate_mart_sql("monthly_sales", report, {})

        assert result.startswith("{{ config(materialized='view') }}")

    def test_mart_sql_ref_replacement(self):
        report = _make_report(
            sql_definition="SELECT * FROM ds-1 WHERE amount > 0",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        ref_name_map = {"ds-1": "stg_orders"}

        result = generate_mart_sql("monthly_sales", report, ref_name_map)

        assert "{{ ref('stg_orders') }}" in result
        assert "ds-1" not in result

    def test_mart_sql_multiple_refs(self):
        report = _make_report(
            sql_definition="SELECT a.*, b.total FROM ds-1 a JOIN view-1 b ON a.id = b.id",
            source_refs=[
                {"id": "ds-1", "type": "dataset"},
                {"id": "view-1", "type": "view"},
            ],
        )
        ref_name_map = {
            "ds-1": "stg_orders",
            "view-1": "int_enriched",
        }

        result = generate_mart_sql("sales_summary", report, ref_name_map)

        assert "{{ ref('stg_orders') }}" in result
        assert "{{ ref('int_enriched') }}" in result

    def test_mart_sql_output_structure(self):
        report = _make_report(
            sql_definition="SELECT col FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="table",
        )
        ref_name_map = {"ds-1": "stg_source"}

        result = generate_mart_sql("my_report", report, ref_name_map)

        lines = result.split("\n")
        assert lines[0] == "{{ config(materialized='table') }}"
        assert lines[1] == ""
        assert "{{ ref('stg_source') }}" in lines[2]

    def test_unresolved_ref_left_as_is(self):
        report = _make_report(
            sql_definition="SELECT * FROM unknown-id",
            source_refs=[{"id": "unknown-id", "type": "dataset"}],
        )

        result = generate_mart_sql("test", report, {})

        assert "unknown-id" in result


class TestMartZipIntegration:
    def test_fact_prefix_in_zip_path(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        report = _make_report(
            report_id="rpt-1",
            name="Monthly Sales",
            report_type="fact",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            domain="Sales",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", reports=[report])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/marts/sales/fct_monthly_sales.sql" in names

    def test_dimension_prefix_in_zip_path(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        report = _make_report(
            report_id="rpt-1",
            name="Customer Dim",
            report_type="dimension",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            domain="Customers",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", reports=[report])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/marts/customers/dim_customer_dim.sql" in names

    def test_domain_directory_grouping(self):
        ds = _make_dataset(ds_id="ds-1", name="Data")
        report1 = _make_report(
            report_id="rpt-1",
            name="Sales Report",
            report_type="fact",
            domain="Sales Analytics",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        report2 = _make_report(
            report_id="rpt-2",
            name="User Dim",
            report_type="dimension",
            domain="User Management",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(
            project, "test", reports=[report1, report2]
        )
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/marts/sales_analytics/fct_sales_report.sql" in names
        assert "models/marts/user_management/dim_user_dim.sql" in names

    def test_mart_sql_has_config_and_ref(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        report = _make_report(
            report_id="rpt-1",
            name="Sales Total",
            report_type="fact",
            sql_definition="SELECT SUM(amount) FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="table",
            domain="Sales",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", reports=[report])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        sql = zf.read("models/marts/sales/fct_sales_total.sql").decode("utf-8")
        assert "{{ config(materialized='table') }}" in sql
        assert "{{ ref('stg_orders') }}" in sql
        assert "ds-1" not in sql

    def test_no_reports_produces_no_marts_dir(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test", reports=[])
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        mart_files = [n for n in names if "marts" in n]
        assert mart_files == []

    def test_duplicate_report_names_deduplicated(self):
        ds = _make_dataset(ds_id="ds-1", name="Data")
        report1 = _make_report(
            report_id="rpt-1",
            name="Summary",
            report_type="fact",
            sql_definition="SELECT 1",
            source_refs=[],
            domain="Sales",
        )
        report2 = _make_report(
            report_id="rpt-2",
            name="Summary",
            report_type="fact",
            sql_definition="SELECT 2",
            source_refs=[],
            domain="Sales",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(
            project, "test", reports=[report1, report2]
        )
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/marts/sales/fct_summary.sql" in names
        assert "models/marts/sales/fct_summary_1.sql" in names

    def test_broken_report_ref_raises_export_validation_error(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        report = _make_report(
            report_id="rpt-1",
            name="Bad Report",
            sql_definition="SELECT * FROM deleted-id",
            source_refs=[{"id": "deleted-id", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[ds])

        with pytest.raises(ExportValidationError, match="deleted entity"):
            generate_dbt_project_zip(project, "test", reports=[report])

    def test_broken_report_ref_includes_report_name(self):
        report = _make_report(
            name="My Broken Report",
            sql_definition="SELECT * FROM gone-id",
            source_refs=[{"id": "gone-id", "type": "dataset"}],
        )
        project = _make_project("Test", datasets=[])

        with pytest.raises(ExportValidationError, match="My Broken Report"):
            generate_dbt_project_zip(project, "test", reports=[report])

    def test_zip_still_contains_staging_and_intermediate_with_reports(self):
        ds = _make_dataset(ds_id="ds-1", name="Orders")
        from app.models.view import View

        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="Enriched",
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="ephemeral",
        )
        report = _make_report(
            report_id="rpt-1",
            name="Final",
            report_type="fact",
            sql_definition="SELECT * FROM view-1",
            source_refs=[{"id": "view-1", "type": "view"}],
            domain="Analytics",
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(
            project, "test", views=[view], reports=[report]
        )
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/staging/stg_orders.sql" in names
        assert "models/intermediate/int_enriched.sql" in names
        assert "models/marts/analytics/fct_final.sql" in names
