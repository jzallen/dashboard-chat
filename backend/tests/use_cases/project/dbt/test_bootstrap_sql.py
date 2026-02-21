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
        sql = generate_bootstrap_sql(
            "project_abc", [("sales_data", ds)], "my-bucket"
        )
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
