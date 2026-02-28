from app.models.dataset import Dataset
from app.use_cases.project._dbt.bootstrap_sql import generate_bootstrap_sql


def _make_dataset(
    id="ds-1",
    project_id="proj-1",
    name="Test Dataset",
    schema_config=None,
):
    return Dataset(
        id=id,
        project_id=project_id,
        name=name,
        schema_config=schema_config or {},
    )


class TestBootstrapSqlStructure:
    def test_generate_bootstrap_sql_creates_schema(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "project_abc";' in sql

    def test_generate_bootstrap_sql_creates_view_per_dataset(self):
        ds1 = _make_dataset(id="ds-1", name="Sales")
        ds2 = _make_dataset(id="ds-2", name="Orders")
        sql = generate_bootstrap_sql(
            "project_abc",
            [("sales", ds1), ("orders", ds2)],
            "my-bucket",
        )
        assert 'CREATE OR REPLACE VIEW "project_abc"."sales" AS' in sql
        assert 'CREATE OR REPLACE VIEW "project_abc"."orders" AS' in sql

    def test_generate_bootstrap_sql_uses_read_parquet_with_s3_path(self):
        ds = _make_dataset(id="ds-1", project_id="proj-1")
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "read_parquet('s3://my-bucket/datasets/proj-1/ds-1/**/*.parquet')" in sql

    def test_generate_bootstrap_sql_wraps_in_transaction(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert sql.startswith("BEGIN;")
        assert sql.endswith("COMMIT;")


class TestBootstrapSqlCleanup:
    def test_generate_bootstrap_sql_drops_existing_views(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "DO $$" in sql
        assert "DROP VIEW IF EXISTS %I.%I CASCADE" in sql
        assert "information_schema.views" in sql

    def test_generate_bootstrap_sql_cleanup_uses_quoted_schema_filter(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "table_schema = 'project_abc'" in sql

    def test_generate_bootstrap_sql_drops_views_before_creating(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        drop_pos = sql.index("DROP VIEW IF EXISTS")
        create_pos = sql.index("CREATE OR REPLACE VIEW")
        assert drop_pos < create_pos


class TestBootstrapSqlEdgeCases:
    def test_generate_bootstrap_sql_when_no_datasets_omits_views(self):
        sql = generate_bootstrap_sql("project_abc", [], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "project_abc";' in sql
        assert "CREATE OR REPLACE VIEW" not in sql
        assert sql.startswith("BEGIN;")
        assert sql.endswith("COMMIT;")

    def test_generate_bootstrap_sql_when_multiple_datasets_creates_all_views(self):
        ds1 = _make_dataset(id="ds-1", name="Sales")
        ds2 = _make_dataset(id="ds-2", name="Orders")
        ds3 = _make_dataset(id="ds-3", name="Products")
        sql = generate_bootstrap_sql(
            "project_abc",
            [("sales", ds1), ("orders", ds2), ("products", ds3)],
            "my-bucket",
        )
        assert sql.count("CREATE OR REPLACE VIEW") == 3

    def test_generate_bootstrap_sql_includes_schema_in_view_path(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("sales_data", ds)], "my-bucket")
        assert '"project_abc"."sales_data"' in sql

    def test_generate_bootstrap_sql_includes_bucket_in_s3_path(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "acme-lake")
        assert "s3://acme-lake/" in sql


class TestBootstrapSqlIdentifierQuoting:
    def test_generate_bootstrap_sql_when_reserved_word_schema_quotes_it(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("select", [("order", ds)], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "select";' in sql
        assert '"select"."order"' in sql

    def test_generate_bootstrap_sql_when_reserved_word_view_quotes_it(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("my_schema", [("table", ds)], "my-bucket")
        assert '"my_schema"."table"' in sql

    def test_generate_bootstrap_sql_when_schema_has_embedded_quote_escapes_it(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql('my"schema', [("test", ds)], "my-bucket")
        assert '"my""schema"' in sql

    def test_generate_bootstrap_sql_cleanup_filter_uses_literal_quoting(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert "table_schema = 'project_abc'" in sql

    def test_generate_bootstrap_sql_when_schema_has_single_quote_escapes_literal(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("it's_weird", [("test", ds)], "my-bucket")
        assert "table_schema = 'it''s_weird'" in sql
        assert "'it''s_weird', r.table_name" in sql


class TestBootstrapSqlTypedColumns:
    def test_generate_bootstrap_sql_when_schema_present_produces_typed_columns(self):
        ds = _make_dataset(schema_config={"fields": {"name": {"type": "text"}, "salary": {"type": "number"}}})
        sql = generate_bootstrap_sql("project_abc", [("employees", ds)], "my-bucket")
        assert "r['name']::text AS \"name\"" in sql
        assert "r['salary']::double precision AS \"salary\"" in sql
        assert "SELECT *" not in sql

    def test_generate_bootstrap_sql_when_empty_schema_falls_back_to_select_star(self):
        ds = _make_dataset(schema_config={})
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_generate_bootstrap_sql_when_empty_fields_falls_back_to_select_star(self):
        ds = _make_dataset(schema_config={"fields": {}})
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_generate_bootstrap_sql_when_none_schema_falls_back_to_select_star(self):
        ds = _make_dataset(schema_config=None)
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_generate_bootstrap_sql_maps_all_app_types_to_pg_types(self):
        fields = {
            "t": {"type": "text"},
            "n": {"type": "number"},
            "b": {"type": "boolean"},
            "s": {"type": "select"},
            "d": {"type": "datetime"},
            "i": {"type": "integer"},
        }
        ds = _make_dataset(schema_config={"fields": fields})
        sql = generate_bootstrap_sql("project_abc", [("typed", ds)], "my-bucket")
        assert '::text AS "t"' in sql
        assert '::double precision AS "n"' in sql
        assert '::boolean AS "b"' in sql
        assert '::text AS "s"' in sql
        assert '::timestamptz AS "d"' in sql
        assert '::bigint AS "i"' in sql

    def test_generate_bootstrap_sql_when_unknown_type_falls_back_to_text(self):
        ds = _make_dataset(schema_config={"fields": {"weird_col": {"type": "unknown_type"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert '::text AS "weird_col"' in sql

    def test_generate_bootstrap_sql_when_reserved_word_columns_quotes_them(self):
        ds = _make_dataset(schema_config={"fields": {"select": {"type": "text"}, "order": {"type": "text"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert 'AS "select"' in sql
        assert 'AS "order"' in sql

    def test_generate_bootstrap_sql_when_typed_view_uses_r_alias(self):
        ds = _make_dataset(schema_config={"fields": {"col1": {"type": "text"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert "FROM read_parquet(" in sql
        assert ") r;" in sql

    def test_generate_bootstrap_sql_when_mixed_typed_and_untyped_uses_appropriate_sql(self):
        ds_typed = _make_dataset(
            id="ds-1",
            schema_config={"fields": {"name": {"type": "text"}}},
        )
        ds_untyped = _make_dataset(id="ds-2", schema_config={})
        sql = generate_bootstrap_sql(
            "project_abc",
            [("typed", ds_typed), ("untyped", ds_untyped)],
            "my-bucket",
        )
        assert "r['name']::text AS \"name\"" in sql
        assert "SELECT * FROM read_parquet(" in sql
