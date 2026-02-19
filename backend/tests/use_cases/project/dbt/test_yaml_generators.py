import yaml

from app.models.dataset import Dataset
from app.use_cases.project.dbt.project_yml import generate_project_yml
from app.use_cases.project.dbt.profiles_yml import generate_profiles_yml
from app.use_cases.project.dbt.sources_yml import generate_sources_yml
from app.use_cases.project.dbt.schema_yml import generate_schema_yml


class TestProjectYml:
    def test_project_yml_fields(self):
        result = yaml.safe_load(generate_project_yml("my_project"))
        assert result["name"] == "my_project"
        assert result["profile"] == "my_project"
        assert result["version"] == "1.0.0"
        assert result["model-paths"] == ["models"]
        assert result["macro-paths"] == ["macros"]

    def test_on_run_start_registers_macros(self):
        result = yaml.safe_load(generate_project_yml("my_project"))
        assert "on-run-start" in result
        assert "{{ register_custom_functions() }}" in result["on-run-start"]


class TestProfilesYml:
    def test_env_var_placeholders_present(self):
        output = generate_profiles_yml("my_project")
        parsed = yaml.safe_load(output)
        settings = parsed["my_project"]["outputs"]["dev"]["settings"]
        assert "env_var('S3_ACCESS_KEY_ID')" in settings["s3_access_key_id"]
        assert "env_var('S3_SECRET_ACCESS_KEY')" in settings["s3_secret_access_key"]
        assert "env_var('S3_REGION'" in settings["s3_region"]
        assert "env_var('S3_ENDPOINT'" in settings["s3_endpoint"]

    def test_no_real_credentials(self):
        output = generate_profiles_yml("my_project")
        parsed = yaml.safe_load(output)
        settings = parsed["my_project"]["outputs"]["dev"]["settings"]
        for value in settings.values():
            assert "env_var(" in value

    def test_duckdb_type(self):
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        assert parsed["my_project"]["outputs"]["dev"]["type"] == "duckdb"


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
    def test_dataset_maps_to_table(self):
        ds = _make_dataset()
        output = generate_sources_yml("my_project", [("test_dataset", ds)])
        parsed = yaml.safe_load(output)
        table = parsed["sources"][0]["tables"][0]
        assert table["name"] == "test_dataset"
        assert table["meta"]["dataset_id"] == "ds-1"
        assert table["description"] == "Source table: Test Dataset"

    def test_external_location_in_meta(self):
        ds = _make_dataset()
        output = generate_sources_yml("my_project", [("test_dataset", ds)])
        parsed = yaml.safe_load(output)
        meta = parsed["sources"][0]["tables"][0]["meta"]
        ext_loc = meta["external_location"]
        assert "env_var('S3_BUCKET')" in ext_loc
        assert "datasets/proj-1/ds-1/**/*.parquet" in ext_loc

    def test_empty_datasets(self):
        output = generate_sources_yml("my_project", [])
        parsed = yaml.safe_load(output)
        assert parsed["sources"][0]["tables"] == []


class TestSchemaYml:
    def test_columns_with_correct_types(self):
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

    def test_empty_schema_config(self):
        ds = _make_dataset(schema_config={})
        output = generate_schema_yml([("empty", ds)])
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["columns"] == []

    def test_model_names_use_stg_prefix(self):
        ds = _make_dataset()
        output = generate_schema_yml([("customers", ds)])
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["name"] == "stg_customers"
