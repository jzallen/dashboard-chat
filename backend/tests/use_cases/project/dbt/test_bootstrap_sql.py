from app.models.dataset import Dataset
from app.use_cases.project.dbt.bootstrap_sql import generate_bootstrap_sql


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


class TestBootstrapSqlBasic:
    def test_creates_schema(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "project_abc";' in sql

    def test_creates_view_per_dataset(self):
        ds1 = _make_dataset(id="ds-1", name="Sales")
        ds2 = _make_dataset(id="ds-2", name="Orders")
        sql = generate_bootstrap_sql(
            "project_abc",
            [("sales", ds1), ("orders", ds2)],
            "my-bucket",
        )
        assert 'CREATE OR REPLACE VIEW "project_abc"."sales" AS' in sql
        assert 'CREATE OR REPLACE VIEW "project_abc"."orders" AS' in sql

    def test_uses_read_parquet_with_s3_path(self):
        ds = _make_dataset(id="ds-1", project_id="proj-1")
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "read_parquet('s3://my-bucket/datasets/proj-1/ds-1/**/*.parquet')" in sql

    def test_wraps_in_transaction(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert sql.startswith("BEGIN;")
        assert sql.endswith("COMMIT;")


class TestBootstrapSqlCleanup:
    def test_drops_existing_views(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "DO $$" in sql
        assert "DROP VIEW IF EXISTS %I.%I CASCADE" in sql
        assert "information_schema.views" in sql

    def test_cleanup_uses_quoted_filter(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "table_schema = 'project_abc'" in sql

    def test_cleanup_before_create(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        drop_pos = sql.index("DROP VIEW IF EXISTS")
        create_pos = sql.index("CREATE OR REPLACE VIEW")
        assert drop_pos < create_pos


class TestBootstrapSqlEdgeCases:
    def test_empty_datasets(self):
        sql = generate_bootstrap_sql("project_abc", [], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "project_abc";' in sql
        assert "CREATE OR REPLACE VIEW" not in sql
        assert sql.startswith("BEGIN;")
        assert sql.endswith("COMMIT;")

    def test_multiple_datasets(self):
        ds1 = _make_dataset(id="ds-1", name="Sales")
        ds2 = _make_dataset(id="ds-2", name="Orders")
        ds3 = _make_dataset(id="ds-3", name="Products")
        sql = generate_bootstrap_sql(
            "project_abc",
            [("sales", ds1), ("orders", ds2), ("products", ds3)],
            "my-bucket",
        )
        assert sql.count("CREATE OR REPLACE VIEW") == 3

    def test_schema_name_in_view_path(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("sales_data", ds)], "my-bucket")
        assert '"project_abc"."sales_data"' in sql

    def test_bucket_in_s3_path(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "acme-lake")
        assert "s3://acme-lake/" in sql


class TestBootstrapSqlIdentifierQuoting:
    """Verify identifiers are quoted to handle reserved words and special cases."""

    def test_reserved_word_schema_name(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("select", [("order", ds)], "my-bucket")
        assert 'CREATE SCHEMA IF NOT EXISTS "select";' in sql
        assert '"select"."order"' in sql

    def test_reserved_word_view_name(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("my_schema", [("table", ds)], "my-bucket")
        assert '"my_schema"."table"' in sql

    def test_schema_with_embedded_quote(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql('my"schema', [("test", ds)], "my-bucket")
        # Double-quotes are escaped by doubling them
        assert '"my""schema"' in sql

    def test_cleanup_filter_uses_literal_quoting(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        # WHERE clause should use single-quoted literal, not raw interpolation
        assert "table_schema = 'project_abc'" in sql

    def test_cleanup_format_uses_literal_quoting(self):
        ds = _make_dataset()
        sql = generate_bootstrap_sql("it's_weird", [("test", ds)], "my-bucket")
        # Single quotes in schema name must be escaped in literals
        assert "table_schema = 'it''s_weird'" in sql
        assert "'it''s_weird', r.table_name" in sql


class TestBootstrapSqlTypedColumns:
    """Tests for typed view column generation from schema_config."""

    def test_dataset_with_schema_produces_typed_columns(self):
        ds = _make_dataset(schema_config={"fields": {"name": {"type": "text"}, "salary": {"type": "number"}}})
        sql = generate_bootstrap_sql("project_abc", [("employees", ds)], "my-bucket")
        assert "r['name']::text AS \"name\"" in sql
        assert "r['salary']::double precision AS \"salary\"" in sql
        # Should NOT have SELECT *
        assert "SELECT *" not in sql

    def test_dataset_without_schema_falls_back_to_select_star(self):
        ds = _make_dataset(schema_config={})
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_dataset_with_empty_fields_falls_back(self):
        ds = _make_dataset(schema_config={"fields": {}})
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_dataset_with_none_schema_falls_back(self):
        ds = _make_dataset(schema_config=None)
        sql = generate_bootstrap_sql("project_abc", [("test_data", ds)], "my-bucket")
        assert "SELECT * FROM read_parquet(" in sql

    def test_all_type_mappings(self):
        """Verify all standard app types map to correct PostgreSQL types."""
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

    def test_unknown_type_falls_back_to_text(self):
        ds = _make_dataset(schema_config={"fields": {"weird_col": {"type": "unknown_type"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert '::text AS "weird_col"' in sql

    def test_reserved_word_column_names_are_quoted(self):
        ds = _make_dataset(schema_config={"fields": {"select": {"type": "text"}, "order": {"type": "text"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert 'AS "select"' in sql
        assert 'AS "order"' in sql

    def test_typed_view_uses_alias_r(self):
        """Typed views use 'r' alias on read_parquet for column access."""
        ds = _make_dataset(schema_config={"fields": {"col1": {"type": "text"}}})
        sql = generate_bootstrap_sql("project_abc", [("test", ds)], "my-bucket")
        assert "FROM read_parquet(" in sql
        assert ") r;" in sql

    def test_mixed_typed_and_untyped_datasets(self):
        """When some datasets have schema and some don't, each uses appropriate SQL."""
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
        # First view is typed
        assert "r['name']::text AS \"name\"" in sql
        # Second view uses SELECT *
        assert "SELECT * FROM read_parquet(" in sql
