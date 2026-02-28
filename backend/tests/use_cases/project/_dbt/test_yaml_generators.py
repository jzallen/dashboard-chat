import yaml

from app.models.dataset import Dataset
from app.use_cases.project._dbt.profiles_yml import generate_profiles_yml
from app.use_cases.project._dbt.project_yml import generate_project_yml
from app.use_cases.project._dbt.schema_yml import generate_schema_yml
from app.use_cases.project._dbt.sources_yml import generate_sources_yml


class TestProjectYml:
    def test_generate_project_yml_sets_name_profile_and_version(self):
        result = yaml.safe_load(generate_project_yml("my_project"))
        assert result["name"] == "my_project"
        assert result["profile"] == "my_project"
        assert result["version"] == "1.0.0"
        assert result["model-paths"] == ["models"]
        assert result["macro-paths"] == ["macros"]

    def test_generate_project_yml_registers_macros_on_run_start(self):
        result = yaml.safe_load(generate_project_yml("my_project"))
        assert "on-run-start" in result
        assert "{{ register_custom_functions() }}" in result["on-run-start"]


class TestProfilesYml:
    def test_generate_profiles_yml_contains_env_var_placeholders(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        settings = parsed["my_project"]["outputs"]["dev"]["settings"]
        assert "env_var('S3_ACCESS_KEY_ID')" in settings["s3_access_key_id"]
        assert "env_var('S3_SECRET_ACCESS_KEY')" in settings["s3_secret_access_key"]
        assert "env_var('S3_REGION'" in settings["s3_region"]
        assert "env_var('S3_ENDPOINT'" in settings["s3_endpoint"]

    def test_generate_profiles_yml_when_dev_target_embeds_no_real_credentials(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        settings = parsed["my_project"]["outputs"]["dev"]["settings"]
        for value in settings.values():
            assert "env_var(" in value

    def test_generate_profiles_yml_dev_target_uses_duckdb(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        assert parsed["my_project"]["outputs"]["dev"]["type"] == "duckdb"

    def test_generate_profiles_yml_includes_postgres_target(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        assert "postgres" in parsed["my_project"]["outputs"]

    def test_generate_profiles_yml_postgres_target_uses_postgres_type(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        assert parsed["my_project"]["outputs"]["postgres"]["type"] == "postgres"

    def test_generate_profiles_yml_postgres_target_uses_env_var_placeholders(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        pg = parsed["my_project"]["outputs"]["postgres"]
        for field in ["host", "port", "user", "password", "dbname", "schema"]:
            assert "env_var(" in pg[field], f"'{field}' should contain env_var placeholder"

    def test_generate_profiles_yml_defaults_to_dev_target(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        assert parsed["my_project"]["target"] == "dev"

    def test_generate_profiles_yml_dev_target_has_correct_structure(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        dev = parsed["my_project"]["outputs"]["dev"]
        assert dev["type"] == "duckdb"
        assert dev["path"] == ":memory:"
        assert dev["extensions"] == ["httpfs"]
        assert "s3_region" in dev["settings"]
        assert "s3_access_key_id" in dev["settings"]
        assert "s3_secret_access_key" in dev["settings"]
        assert "s3_endpoint" in dev["settings"]
        assert "s3_url_style" in dev["settings"]

    def test_generate_profiles_yml_postgres_target_embeds_no_real_credentials(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        pg = parsed["my_project"]["outputs"]["postgres"]
        assert "env_var(" in pg["user"]
        assert "env_var(" in pg["password"]


def _make_dataset(
    id: str = "ds-1",
    project_id: str = "proj-1",
    name: str = "Test Dataset",
    schema_config: dict | None = None,
) -> Dataset:
    return Dataset(
        id=id,
        project_id=project_id,
        name=name,
        schema_config=schema_config or {},
    )


class TestSourcesYml:
    def test_generate_sources_yml_maps_dataset_to_table(self):
        ds = _make_dataset()
        output = generate_sources_yml("my_project", [("test_dataset", ds)])
        parsed = yaml.safe_load(output)
        table = parsed["sources"][0]["tables"][0]
        assert table["name"] == "test_dataset"
        assert table["meta"]["dataset_id"] == "ds-1"
        assert table["description"] == "Source table: Test Dataset"

    def test_generate_sources_yml_includes_external_location_in_meta(self):
        ds = _make_dataset()
        output = generate_sources_yml("my_project", [("test_dataset", ds)])
        parsed = yaml.safe_load(output)
        meta = parsed["sources"][0]["tables"][0]["meta"]
        ext_loc = meta["external_location"]
        assert "env_var('S3_BUCKET')" in ext_loc
        assert "datasets/proj-1/ds-1/**/*.parquet" in ext_loc

    def test_generate_sources_yml_when_no_datasets_produces_empty_tables(self):
        output = generate_sources_yml("my_project", [])
        parsed = yaml.safe_load(output)
        assert parsed["sources"][0]["tables"] == []


class TestSchemaYml:
    def test_generate_schema_yml_maps_field_types_to_dbt_types(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "name": {"type": "text"},
                    "salary": {"type": "number"},
                    "active": {"type": "boolean"},
                    "role": {"type": "select"},
                }
            }
        )
        output = generate_schema_yml([("employees", ds)])
        parsed = yaml.safe_load(output)
        model = parsed["models"][0]
        cols = {c["name"]: c["data_type"] for c in model["columns"]}
        assert cols["name"] == "string"
        assert cols["salary"] == "float64"
        assert cols["active"] == "boolean"
        assert cols["role"] == "string"

    def test_generate_schema_yml_when_empty_schema_produces_no_columns(self):
        ds = _make_dataset(schema_config={})
        output = generate_schema_yml([("empty", ds)])
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["columns"] == []

    def test_generate_schema_yml_prefixes_model_names_with_stg(self):
        ds = _make_dataset()
        output = generate_schema_yml([("customers", ds)])
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["name"] == "stg_customers"
