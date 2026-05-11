import pytest
import yaml

from app.models.dataset import Dataset
from app.models.report import Report
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
        assert "s3_use_ssl" in dev["settings"]
        assert "s3_url_style" in dev["settings"]

    def test_generate_profiles_yml_dev_target_exposes_s3_use_ssl_env_var(self):
        """ADR-024 Phase 0: MinIO-running customers should not have to patch
        the exported profiles.yml post-unzip. Expose `s3_use_ssl` as a Jinja
        `env_var(...)` reference with default `true` (preserving AWS-S3
        behavior) so an operator can set `S3_USE_SSL=false` against MinIO."""
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        s3_use_ssl = parsed["my_project"]["outputs"]["dev"]["settings"]["s3_use_ssl"]
        assert "env_var('S3_USE_SSL'" in s3_use_ssl
        assert "'true'" in s3_use_ssl
        assert "as_bool" in s3_use_ssl

    def test_generate_profiles_yml_dev_target_orders_s3_use_ssl_between_endpoint_and_url_style(self):
        """The DuckDB profile seeder treats `s3_*` keys as positional context
        for readers; keeping `s3_use_ssl` between `s3_endpoint` and
        `s3_url_style` makes the rendered profile easy to scan and matches
        the seeder's own ordering in tests/integration."""
        parsed = yaml.safe_load(generate_profiles_yml("my_project"))
        keys = list(parsed["my_project"]["outputs"]["dev"]["settings"].keys())
        endpoint_idx = keys.index("s3_endpoint")
        use_ssl_idx = keys.index("s3_use_ssl")
        url_style_idx = keys.index("s3_url_style")
        assert endpoint_idx < use_ssl_idx < url_style_idx

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

    def test_generate_schema_yml_omits_tests_when_no_columns(self):
        """A schema-less dataset emits no columns and no tests — the
        first-column rule must not fabricate a column to attach to."""
        ds = _make_dataset(schema_config={})
        output = generate_schema_yml([("empty", ds)])
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["columns"] == []

    # --- Phase 2: constraint-driven dbt test emission --------------------
    #
    # The Phase-0 placeholder ("always emit not_null on the first column")
    # is replaced by a real translation from `schema_config["fields"][col]
    # ["constraints"]` into per-column dbt tests. See ADR-019 Phase 2 and
    # docs/feature/dbt-test-validation/distill/roadmap.json step 02-01.

    def test_generate_schema_yml_translates_required_to_not_null(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "email": {"type": "text", "constraints": {"required": True}},
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["name"] == "email"
        assert col["tests"] == ["not_null"]

    def test_generate_schema_yml_translates_unique_to_unique(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "user_id": {"type": "text", "constraints": {"unique": True}},
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == ["unique"]

    def test_generate_schema_yml_translates_accepted_values_to_accepted_values_test(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "status": {
                        "type": "select",
                        "constraints": {"accepted_values": ["active", "inactive"]},
                    },
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == [{"accepted_values": {"values": ["active", "inactive"]}}]

    def test_generate_schema_yml_translates_range_min_only_to_expression_is_true(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "age": {"type": "number", "constraints": {"range": {"min": 18}}},
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == [{"dbt_utils.expression_is_true": {"expression": ">= 18"}}]

    def test_generate_schema_yml_translates_range_max_only_to_expression_is_true(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "score": {"type": "number", "constraints": {"range": {"max": 100}}},
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == [{"dbt_utils.expression_is_true": {"expression": "<= 100"}}]

    def test_generate_schema_yml_translates_range_min_and_max_to_two_expressions(self):
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "score": {
                        "type": "number",
                        "constraints": {"range": {"min": 0, "max": 100}},
                    },
                }
            }
        )
        output = generate_schema_yml([("users", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == [
            {"dbt_utils.expression_is_true": {"expression": ">= 0"}},
            {"dbt_utils.expression_is_true": {"expression": "<= 100"}},
        ]

    def test_generate_schema_yml_emits_combined_constraint_tests_in_deterministic_order(self):
        """Order: not_null, unique, accepted_values, expression_is_true (min, max)."""
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "code": {
                        "type": "select",
                        "constraints": {
                            "required": True,
                            "unique": True,
                            "accepted_values": ["A", "B"],
                            "range": {"min": 1, "max": 9},
                        },
                    },
                }
            }
        )
        output = generate_schema_yml([("widgets", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert col["tests"] == [
            "not_null",
            "unique",
            {"accepted_values": {"values": ["A", "B"]}},
            {"dbt_utils.expression_is_true": {"expression": ">= 1"}},
            {"dbt_utils.expression_is_true": {"expression": "<= 9"}},
        ]

    @pytest.mark.parametrize(
        "constraints",
        [
            None,  # No constraints key at all
            {},  # Empty constraints dict
            {"required": False},  # Falsy required
            {"unique": False},  # Falsy unique
            {"accepted_values": []},  # Empty accepted_values list
            {"range": {}},  # Empty range dict
        ],
        ids=[
            "no-constraints-key",
            "empty-dict",
            "falsy-required",
            "falsy-unique",
            "empty-accepted-values",
            "empty-range",
        ],
    )
    def test_generate_schema_yml_omits_tests_key_when_constraints_falsy_or_missing(self, constraints):
        field: dict = {"type": "text"}
        if constraints is not None:
            field["constraints"] = constraints
        ds = _make_dataset(schema_config={"fields": {"name": field}})
        output = generate_schema_yml([("things", ds)])
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]
        assert "tests" not in col

    def test_generate_schema_yml_when_zero_constraints_across_columns_emits_no_tests_at_all(self):
        """The Phase-0 placeholder is gone: a multi-column dataset with no
        constraints on any column produces a staging model with NO `tests:`
        keys anywhere. This is the contract that allows constraint-free
        projects to skip `dbt deps` and ship lean."""
        ds = _make_dataset(
            schema_config={
                "fields": {
                    "region": {"type": "text"},
                    "quantity": {"type": "number"},
                }
            }
        )
        output = generate_schema_yml([("orders", ds)])
        parsed = yaml.safe_load(output)
        for col in parsed["models"][0]["columns"]:
            assert "tests" not in col


def _make_report(
    report_id: str = "rpt-1",
    name: str = "Monthly Sales",
    report_type: str = "fact",
    domain: str = "Sales",
    columns_metadata: list[dict] | None = None,
    materialization: str = "table",
) -> Report:
    return Report(
        id=report_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition="SELECT 1",
        report_type=report_type,
        domain=domain,
        columns_metadata=columns_metadata or [],
        materialization=materialization,
    )


class TestSchemaYmlWithReports:
    def test_schema_yml_with_report(self):
        ds = _make_dataset()
        report = _make_report(name="Sales Total", report_type="fact")
        output = generate_schema_yml(
            [("orders", ds)],
            reports=[("sales_total", report)],
        )
        parsed = yaml.safe_load(output)

        model_names = [m["name"] for m in parsed["models"]]
        assert "stg_orders" in model_names
        assert "fct_sales_total" in model_names

    def test_schema_yml_dimension_report_prefix(self):
        report = _make_report(name="Customer Dim", report_type="dimension")
        output = generate_schema_yml(
            [],
            reports=[("customer_dim", report)],
        )
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["name"] == "dim_customer_dim"

    def test_schema_yml_semantic_metadata(self):
        report = _make_report(
            columns_metadata=[
                {
                    "name": "amount",
                    "semantic_role": "measure",
                    "semantic_type": "sum",
                },
            ],
        )
        output = generate_schema_yml(
            [],
            reports=[("sales", report)],
        )
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]

        assert col["name"] == "amount"
        assert col["meta"]["semantic_role"] == "measure"
        assert col["meta"]["semantic_type"] == "sum"

    def test_schema_yml_time_granularity(self):
        report = _make_report(
            columns_metadata=[
                {
                    "name": "order_date",
                    "semantic_role": "dimension",
                    "semantic_type": "time",
                    "time_granularity": "day",
                },
            ],
        )
        output = generate_schema_yml(
            [],
            reports=[("sales", report)],
        )
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]

        assert col["meta"]["semantic_role"] == "dimension"
        assert col["meta"]["semantic_type"] == "time"
        assert col["meta"]["time_granularity"] == "day"

    def test_schema_yml_column_with_expr_and_description(self):
        report = _make_report(
            columns_metadata=[
                {
                    "name": "revenue",
                    "semantic_role": "measure",
                    "semantic_type": "sum",
                    "expr": "price * quantity",
                    "description": "Total revenue",
                },
            ],
        )
        output = generate_schema_yml(
            [],
            reports=[("sales", report)],
        )
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]

        assert col["meta"]["expr"] == "price * quantity"
        assert col["meta"]["description"] == "Total revenue"

    def test_schema_yml_report_no_metadata(self):
        report = _make_report(columns_metadata=[])
        output = generate_schema_yml(
            [],
            reports=[("sales", report)],
        )
        parsed = yaml.safe_load(output)
        assert parsed["models"][0]["columns"] == []

    def test_schema_yml_report_column_without_meta_fields(self):
        """Column with only a name and no semantic fields gets no meta key."""
        report = _make_report(
            columns_metadata=[{"name": "id"}],
        )
        output = generate_schema_yml(
            [],
            reports=[("sales", report)],
        )
        parsed = yaml.safe_load(output)
        col = parsed["models"][0]["columns"][0]

        assert col["name"] == "id"
        assert "meta" not in col
