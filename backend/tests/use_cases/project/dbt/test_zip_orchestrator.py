"""Tests for the dbt zip orchestrator."""

import zipfile
from io import BytesIO

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.transform import Transform
from app.use_cases.project.dbt import generate_dbt_project_zip


def _make_project(name: str, datasets: list[Dataset] | None = None) -> Project:
    return Project(id="proj-1", name=name, datasets=datasets or [])


def _make_dataset(
    ds_id: str = "ds-1",
    name: str = "Test Dataset",
    schema_config: dict | None = None,
    transforms: list | None = None,
) -> Dataset:
    return Dataset(
        id=ds_id,
        project_id="proj-1",
        name=name,
        schema_config=schema_config or {"fields": {"col_a": {"type": "text"}}},
        transforms=transforms or [],
    )


class TestZipContents:
    def test_project_with_datasets_contains_expected_files(self):
        ds1 = _make_dataset(ds_id="ds-1", name="Leads")
        ds2 = _make_dataset(ds_id="ds-2", name="Opportunities")
        project = _make_project("Sales Pipeline", datasets=[ds1, ds2])

        zip_bytes = generate_dbt_project_zip(project, "sales_pipeline")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "dbt_project.yml" in names
        assert "profiles.yml" in names
        assert "models/staging/sources.yml" in names
        assert "models/schema.yml" in names
        assert "macros/custom_functions.sql" in names
        assert "scripts/bootstrap_db.sql" in names
        assert "README.md" in names
        assert "models/staging/stg_leads.sql" in names
        assert "models/staging/stg_opportunities.sql" in names

    def test_empty_project_contains_skeleton_files(self):
        project = _make_project("Empty Project")

        zip_bytes = generate_dbt_project_zip(project, "empty_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "dbt_project.yml" in names
        assert "profiles.yml" in names
        assert "models/staging/sources.yml" in names
        assert "models/schema.yml" in names
        assert "macros/custom_functions.sql" in names
        assert "scripts/bootstrap_db.sql" in names
        assert "README.md" in names
        # No stg_ files
        stg_files = [n for n in names if n.startswith("models/staging/stg_")]
        assert stg_files == []

    def test_deduplicated_names_used_consistently(self):
        ds1 = _make_dataset(ds_id="ds-1", name="Sales Data")
        ds2 = _make_dataset(ds_id="ds-2", name="Sales-Data")
        project = _make_project("Test", datasets=[ds1, ds2])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/staging/stg_sales_data.sql" in names
        assert "models/staging/stg_sales_data_1.sql" in names

        # Verify sources.yml references both names
        sources_content = zf.read("models/staging/sources.yml").decode("utf-8")
        assert "sales_data" in sources_content
        assert "sales_data_1" in sources_content

        # Verify schema.yml references both names
        schema_content = zf.read("models/schema.yml").decode("utf-8")
        assert "stg_sales_data" in schema_content
        assert "stg_sales_data_1" in schema_content

    def test_all_files_are_valid_utf8(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        for name in zf.namelist():
            content = zf.read(name)
            content.decode("utf-8")  # Raises if not valid UTF-8

    def test_project_name_appears_in_readme(self):
        project = _make_project("My Project")

        zip_bytes = generate_dbt_project_zip(project, "my_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        readme = zf.read("README.md").decode("utf-8")
        assert "My Project" in readme

    def test_macros_file_contains_custom_functions(self):
        project = _make_project("Test")

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        macros = zf.read("macros/custom_functions.sql").decode("utf-8")
        assert "title_case" in macros
        assert "snake_case" in macros
        assert "kebab_case" in macros

    def test_bootstrap_sql_contains_views(self):
        ds = _make_dataset(ds_id="ds-1", name="Sales Data")
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        bootstrap = zf.read("scripts/bootstrap_db.sql").decode("utf-8")
        assert "CREATE SCHEMA IF NOT EXISTS" in bootstrap
        assert "CREATE OR REPLACE VIEW" in bootstrap
        assert "read_parquet(" in bootstrap
        assert "sales_data" in bootstrap

    def test_bootstrap_sql_uses_parameterized_bucket(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        bootstrap = zf.read("scripts/bootstrap_db.sql").decode("utf-8")
        assert "__S3_BUCKET__" in bootstrap

    def test_readme_includes_postgres_instructions(self):
        project = _make_project("My Project")

        zip_bytes = generate_dbt_project_zip(project, "my_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        readme = zf.read("README.md").decode("utf-8")
        assert "pg_duckdb" in readme
        assert "bootstrap_db.sql" in readme
        assert "dbt run --target postgres" in readme
        assert "PG_HOST" in readme
        assert "dbt-postgres" in readme

    def test_profiles_yml_has_both_targets(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        profiles = zf.read("profiles.yml").decode("utf-8")
        assert "duckdb" in profiles
        assert "postgres" in profiles

    def test_dataset_with_transforms_generates_sql(self):
        ds = _make_dataset(
            transforms=[
                Transform(
                    id="t-1",
                    name="Trim col_a",
                    condition_json=None,
                    transform_type="clean",
                    target_column="col_a",
                    expression_config={"operation": "trim"},
                    status="enabled",
                ),
            ],
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        sql = zf.read("models/staging/stg_test_dataset.sql").decode("utf-8")
        assert "TRIM(col_a)" in sql
        assert "source(" in sql
