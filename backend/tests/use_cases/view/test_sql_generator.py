"""Tests for ViewSQLGenerator."""

from app.models.view import DisplayType, View, ViewColumn, ViewFilter, ViewJoin
from app.use_cases.view.sql_generator import ViewSQLGenerator

_DEFAULT_REFS = [{"id": "ds1", "type": "dataset", "name": "orders"}]


def _make_view(
    columns=None,
    joins=None,
    filters=None,
    grain=None,
    source_refs=None,
) -> View:
    return View(
        id="view-1",
        project_id="proj-1",
        org_id="org-1",
        name="Test View",
        sql_definition="",
        source_refs=_DEFAULT_REFS if source_refs is None else source_refs,
        columns=columns or [],
        joins=joins or [],
        filters=filters or [],
        grain=grain,
    )


def _col(name: str, source_ref: str, source_column: str, display_type: str, alias: str | None = None) -> ViewColumn:
    return ViewColumn(
        name=name,
        source_ref=source_ref,
        source_column=source_column,
        display_type=DisplayType(display_type),
        alias=alias,
    )


class TestGenerateExecutable:
    def test_single_source_single_column(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("order_id", "ds1", "order_id", "text")],
        )
        sql = gen.generate_executable(view)
        assert 'CAST(s0."order_id" AS TEXT) AS "order_id"' in sql
        assert "FROM orders AS s0" in sql

    def test_cast_types_match_backend_map(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[
                _col("id", "ds1", "id", "serial"),
                _col("amount", "ds1", "amount", "decimal"),
                _col("active", "ds1", "active", "boolean"),
                _col("created", "ds1", "created", "date"),
            ],
        )
        sql = gen.generate_executable(view)
        assert "AS INTEGER" in sql
        assert "AS DECIMAL" in sql
        assert "AS BOOLEAN" in sql
        assert "AS DATE" in sql

    def test_alias_used_as_output_name(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("total", "ds1", "amount", "decimal", alias="total_amount")],
        )
        sql = gen.generate_executable(view)
        assert 'AS "total_amount"' in sql

    def test_empty_columns_uses_select_star(self):
        gen = ViewSQLGenerator()
        view = _make_view(columns=[])
        sql = gen.generate_executable(view)
        assert "SELECT *" in sql

    def test_join_clause(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            source_refs=[
                {"id": "ds1", "type": "dataset", "name": "orders"},
                {"id": "ds2", "type": "dataset", "name": "customers"},
            ],
            columns=[
                _col("order_id", "ds1", "order_id", "text"),
                _col("name", "ds2", "name", "text"),
            ],
            joins=[
                ViewJoin(
                    left_ref="ds1",
                    left_column="customer_id",
                    right_ref="ds2",
                    right_column="id",
                    join_type="LEFT",
                )
            ],
        )
        sql = gen.generate_executable(view)
        assert 'LEFT JOIN customers AS s1 ON s0."customer_id" = s1."id"' in sql

    def test_filter_equals(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("status", "ds1", "status", "text")],
            filters=[ViewFilter(source_ref="ds1", column="status", operator="=", value="active")],
        )
        sql = gen.generate_executable(view)
        assert """WHERE s0."status" = 'active'""" in sql

    def test_filter_is_null(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("name", "ds1", "name", "text")],
            filters=[ViewFilter(source_ref="ds1", column="name", operator="IS NULL")],
        )
        sql = gen.generate_executable(view)
        assert 's0."name" IS NULL' in sql

    def test_filter_is_not_null(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("name", "ds1", "name", "text")],
            filters=[ViewFilter(source_ref="ds1", column="name", operator="IS NOT NULL")],
        )
        sql = gen.generate_executable(view)
        assert 's0."name" IS NOT NULL' in sql

    def test_filter_in(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("status", "ds1", "status", "text")],
            filters=[ViewFilter(source_ref="ds1", column="status", operator="IN", value="'a','b'")],
        )
        sql = gen.generate_executable(view)
        assert """s0."status" IN ('a','b')""" in sql

    def test_multiple_filters_combined_with_and(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("status", "ds1", "status", "text")],
            filters=[
                ViewFilter(source_ref="ds1", column="status", operator="=", value="active"),
                ViewFilter(source_ref="ds1", column="amount", operator=">", value="100"),
            ],
        )
        sql = gen.generate_executable(view)
        assert "AND" in sql

    def test_ref_mode_dataset(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[_col("order_id", "ds1", "order_id", "text")],
        )
        sql = gen.generate_executable(view, ref_mode=True)
        assert "{{ ref('stg_orders') }}" in sql

    def test_ref_mode_view(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            source_refs=[{"id": "v1", "type": "view", "name": "enriched"}],
            columns=[_col("order_id", "v1", "order_id", "text")],
        )
        sql = gen.generate_executable(view, ref_mode=True)
        assert "{{ ref('int_enriched') }}" in sql

    def test_no_source_refs_no_from(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            source_refs=[],
            columns=[],
        )
        sql = gen.generate_executable(view)
        assert "SELECT *" in sql
        assert "FROM" not in sql


class TestGenerateDisplay:
    def test_display_uses_display_types(self):
        gen = ViewSQLGenerator()
        view = _make_view(
            columns=[
                _col("name", "ds1", "name", "category"),
                _col("count", "ds1", "count", "integer"),
            ],
        )
        sql = gen.generate_display(view)
        assert "AS category" in sql
        assert "AS integer" in sql

    def test_display_has_comment_header(self):
        gen = ViewSQLGenerator()
        view = _make_view(columns=[_col("id", "ds1", "id", "text")])
        sql = gen.generate_display(view)
        assert sql.startswith("-- SQL Preview")
