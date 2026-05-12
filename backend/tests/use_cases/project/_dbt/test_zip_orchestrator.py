"""Tests for the dbt zip orchestrator."""

import zipfile
from io import BytesIO
from typing import ClassVar

from app.models.dataset import Dataset
from app.models.project import Project
from app.models.transform import Transform
from app.plugins.registry import PluginRegistry
from app.use_cases.project._dbt import generate_dbt_project_zip


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
    def test_generate_zip_when_datasets_present_contains_all_expected_files(self):
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

    def test_generate_zip_when_no_datasets_contains_skeleton_files(self):
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
        stg_files = [n for n in names if n.startswith("models/staging/stg_")]
        assert stg_files == []

    def test_generate_zip_when_duplicate_names_deduplicates_consistently(self):
        ds1 = _make_dataset(ds_id="ds-1", name="Sales Data")
        ds2 = _make_dataset(ds_id="ds-2", name="Sales-Data")
        project = _make_project("Test", datasets=[ds1, ds2])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "models/staging/stg_sales_data.sql" in names
        assert "models/staging/stg_sales_data_1.sql" in names

        sources_content = zf.read("models/staging/sources.yml").decode("utf-8")
        assert "sales_data" in sources_content
        assert "sales_data_1" in sources_content

        schema_content = zf.read("models/schema.yml").decode("utf-8")
        assert "stg_sales_data" in schema_content
        assert "stg_sales_data_1" in schema_content

    def test_generate_zip_produces_valid_utf8_files(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        for name in zf.namelist():
            content = zf.read(name)
            content.decode("utf-8")  # Raises if not valid UTF-8

    def test_generate_zip_includes_project_name_in_readme(self):
        project = _make_project("My Project")

        zip_bytes = generate_dbt_project_zip(project, "my_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        readme = zf.read("README.md").decode("utf-8")
        assert "My Project" in readme

    def test_generate_zip_macros_file_contains_custom_functions(self):
        project = _make_project("Test")

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        macros = zf.read("macros/custom_functions.sql").decode("utf-8")
        assert "title_case" in macros
        assert "snake_case" in macros
        assert "kebab_case" in macros

    def test_generate_zip_bootstrap_sql_contains_views(self):
        ds = _make_dataset(ds_id="ds-1", name="Sales Data")
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        bootstrap = zf.read("scripts/bootstrap_db.sql").decode("utf-8")
        assert "CREATE SCHEMA IF NOT EXISTS" in bootstrap
        assert "CREATE OR REPLACE VIEW" in bootstrap
        assert "read_parquet(" in bootstrap
        assert "sales_data" in bootstrap

    def test_generate_zip_bootstrap_sql_uses_parameterized_bucket(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        bootstrap = zf.read("scripts/bootstrap_db.sql").decode("utf-8")
        assert "__S3_BUCKET__" in bootstrap

    def test_generate_zip_readme_includes_postgres_instructions(self):
        project = _make_project("My Project")

        zip_bytes = generate_dbt_project_zip(project, "my_project")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        readme = zf.read("README.md").decode("utf-8")
        assert "pg_duckdb" in readme
        assert "bootstrap_db.sql" in readme
        assert "dbt run --target postgres" in readme
        assert "PG_HOST" in readme
        assert "dbt-postgres" in readme

    def test_generate_zip_profiles_yml_has_both_targets(self):
        ds = _make_dataset()
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))

        profiles = zf.read("profiles.yml").decode("utf-8")
        assert "duckdb" in profiles
        assert "postgres" in profiles

    def test_generate_zip_when_dataset_has_transforms_generates_sql(self):
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
        # L2 contract-mirroring rewrite per nw-test-refactoring-catalog: the
        # legacy substring assertion ``'TRIM("col_a")' in sql`` pinned the
        # CTE compiler's bare-string TRIM emission. After ADR-026 MR-5 the
        # ibis pipeline emits ``TRIM("<table_alias>"."col_a", '<chars>')``
        # — same operation, different byte shape. The contract surface is
        # (a) the TRIM applies to col_a, and (b) the dbt-source macro
        # appears at the FROM clause.
        assert "TRIM(" in sql
        assert '"col_a"' in sql
        assert "source(" in sql

    def test_generate_zip_without_plugin_registry_has_no_plugin_macros(self):
        project = _make_project("Test")

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = zf.namelist()

        plugin_macro_files = [n for n in names if n.startswith("macros/plugin_")]
        assert plugin_macro_files == []

    def test_generate_zip_when_range_constraint_present_writes_packages_yml_with_dbt_utils(self):
        """Phase 2: a dataset with any range constraint emits dbt_utils tests,
        which require dbt_utils to be installed via `dbt deps`. The zip MUST
        ship a top-level packages.yml referencing dbt-labs/dbt_utils so the
        eject-then-test cycle's `dbt deps` step succeeds."""
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "score": {"type": "number", "constraints": {"range": {"min": 0, "max": 100}}},
                }
            }
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "packages.yml" in names
        import yaml as _yaml

        parsed = _yaml.safe_load(zf.read("packages.yml").decode("utf-8"))
        packages = parsed["packages"]
        assert any(p.get("package") == "dbt-labs/dbt_utils" for p in packages), (
            f"Expected dbt-labs/dbt_utils in packages, got: {packages}"
        )
        dbt_utils_entry = next(p for p in packages if p["package"] == "dbt-labs/dbt_utils")
        assert dbt_utils_entry["version"] == [">=1.1.0", "<2.0.0"]

    def test_generate_zip_when_only_non_range_constraints_present_omits_packages_yml(self):
        """When the only emitted tests are core dbt tests (not_null, unique,
        accepted_values), `dbt deps` is unnecessary and packages.yml is NOT
        written. This keeps simple projects from being forced through an
        extra package-install step."""
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "email": {"type": "text", "constraints": {"required": True, "unique": True}},
                    "status": {
                        "type": "select",
                        "constraints": {"accepted_values": ["A", "B"]},
                    },
                }
            }
        )
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "packages.yml" not in names

    def test_generate_zip_when_no_constraints_at_all_omits_packages_yml(self):
        """A constraint-free project ships no packages.yml — confirms the
        Phase-0 placeholder (which would have forced a packages.yml via a
        always-emitted `not_null`) is gone, AND that absent constraints
        produce no dbt_utils dependency."""
        ds = _make_dataset(schema_config={"fields": {"col_a": {"type": "text"}}})
        project = _make_project("Test", datasets=[ds])

        zip_bytes = generate_dbt_project_zip(project, "test")
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "packages.yml" not in names

    def test_generate_zip_with_plugin_macros_includes_macro_files(self):
        class FakePlugin:
            name = "test_plugin"
            extensions: ClassVar[list[str]] = [".fake"]
            label = "Fake Format"
            dbt_macros: ClassVar[dict[str, str]] = {"parse_date": "CREATE OR REPLACE FUNCTION ..."}

            def validate(self, file_content, filename):
                pass

            def detect_choices(self, file_content, filename):
                return None

            def process(self, file_content, filename, choices=None):
                pass

        plugin = FakePlugin()
        registry = PluginRegistry([plugin])
        project = _make_project("Test")

        zip_bytes = generate_dbt_project_zip(project, "test", plugin_registry=registry)
        zf = zipfile.ZipFile(BytesIO(zip_bytes))
        names = set(zf.namelist())

        assert "macros/plugin_test_plugin.sql" in names
        content = zf.read("macros/plugin_test_plugin.sql").decode("utf-8")
        assert "CREATE OR REPLACE FUNCTION ..." in content
