"""Tests for ViewIbisCompiler (ADR-026 MR-1).

Test rewrites at L2 (contract-mirroring) per the brownfield triage in the
DELIVER roadmap. Each test asserts the customer-visible contract — what
columns are selected, what joins are emitted, what predicate is applied,
that the dbt-ref path emits ref macros, that operators render correctly —
rather than the byte-exact f-string output of the legacy generator.

The legacy ``ViewSQLGenerator`` shim is also exercised here so the
deprecation contract (delegates to the new compiler, emits a
DeprecationWarning) stays under test until MR-2 retires the shim.
"""

from __future__ import annotations

import warnings

import pytest
from pydantic import ValidationError

from app.models.view import (
    DisplayType,
    View,
    ViewColumn,
    ViewFilter,
    ViewJoin,
    parse_view_filter,
)
from app.use_cases.view.sql_generator import ViewIbisCompiler, ViewSQLGenerator

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
    def test_single_source_single_column_selects_that_column(self):
        view = _make_view(columns=[_col("order_id", "ds1", "order_id", "text")])
        sql = ViewIbisCompiler().generate_executable(view)
        assert '"orders"' in sql
        # The column "order_id" appears either via explicit projection or as
        # the SELECT * of a synthetic single-column source.
        assert "order_id" in sql or "*" in sql

    def test_aliased_columns_render_in_projection(self):
        """Aliases force an explicit projection (ibis cannot collapse to ``*``)
        so each column's output name surfaces in the rendered SQL."""
        view = _make_view(
            columns=[
                _col("id", "ds1", "id", "serial", alias="row_id"),
                _col("amount", "ds1", "amount", "decimal", alias="total_amount"),
                _col("region", "ds1", "region", "text", alias="region_name"),
            ]
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert "row_id" in sql
        assert "total_amount" in sql
        assert "region_name" in sql

    def test_alias_used_as_output_name(self):
        view = _make_view(columns=[_col("total", "ds1", "amount", "decimal", alias="total_amount")])
        sql = ViewIbisCompiler().generate_executable(view)
        assert "total_amount" in sql

    def test_empty_columns_uses_select_star(self):
        view = _make_view(columns=[])
        sql = ViewIbisCompiler().generate_executable(view)
        assert "SELECT" in sql and "*" in sql

    def test_join_clause_references_both_sources(self):
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
        sql = ViewIbisCompiler().generate_executable(view)
        assert '"orders"' in sql
        assert '"customers"' in sql
        # Join predicate must reference customer_id and id (the join keys).
        assert '"customer_id"' in sql
        # ibis renders LEFT JOIN as "LEFT OUTER JOIN" — assert via the
        # contract that this is not an inner join while remaining tolerant of
        # the exact ibis surface.
        assert "LEFT" in sql.upper()

    def test_filter_equals_renders_predicate(self):
        view = _make_view(
            columns=[_col("status", "ds1", "status", "text")],
            filters=[ViewFilter(source_ref="ds1", column="status", operator="=", value="active")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert "WHERE" in sql
        assert '"status"' in sql
        # The value is a quoted literal, not interpolated as bare text.
        assert "'active'" in sql

    def test_filter_is_null_renders_null_predicate(self):
        view = _make_view(
            columns=[_col("name", "ds1", "name", "text")],
            filters=[ViewFilter(source_ref="ds1", column="name", operator="IS NULL")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert "IS NULL" in sql.upper()

    def test_filter_is_not_null_renders_not_null_predicate(self):
        view = _make_view(
            columns=[_col("name", "ds1", "name", "text")],
            filters=[ViewFilter(source_ref="ds1", column="name", operator="IS NOT NULL")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert "IS NOT NULL" in sql.upper()

    def test_filter_in_renders_in_clause(self):
        view = _make_view(
            columns=[_col("status", "ds1", "status", "text")],
            filters=[ViewFilter(source_ref="ds1", column="status", operator="IN", value="'a','b'")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert "IN" in sql.upper()
        assert "'a'" in sql
        assert "'b'" in sql

    def test_multiple_filters_combine_with_and(self):
        view = _make_view(
            columns=[
                _col("status", "ds1", "status", "text"),
                _col("amount", "ds1", "amount", "integer"),
            ],
            filters=[
                ViewFilter(source_ref="ds1", column="status", operator="=", value="active"),
                ViewFilter(source_ref="ds1", column="amount", operator=">", value="100"),
            ],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        # Both predicates appear in the WHERE; ibis renders them with AND.
        assert "'active'" in sql
        assert "100" in sql
        assert "AND" in sql.upper()

    def test_ref_mode_dataset_emits_stg_ref(self):
        view = _make_view(columns=[_col("order_id", "ds1", "order_id", "text")])
        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)
        assert "{{ ref('stg_orders') }}" in sql

    def test_ref_mode_view_emits_int_ref(self):
        view = _make_view(
            source_refs=[{"id": "v1", "type": "view", "name": "enriched"}],
            columns=[_col("order_id", "v1", "order_id", "text")],
        )
        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)
        assert "{{ ref('int_enriched') }}" in sql

    def test_no_source_refs_no_from(self):
        view = _make_view(source_refs=[], columns=[])
        sql = ViewIbisCompiler().generate_executable(view)
        assert "SELECT" in sql and "*" in sql
        assert "FROM" not in sql


class TestGenerateDisplay:
    def test_display_has_comment_header(self):
        view = _make_view(columns=[_col("id", "ds1", "id", "text")])
        sql = ViewIbisCompiler().generate_display(view)
        assert sql.startswith("-- SQL Preview")


class TestInjectionVectorClosure:
    """ADR-026 Gap 1 regression: ``ViewFilter.value`` must round-trip as a
    string literal, never as embedded SQL.

    Per DWD-4 the closure mechanism is ibis literal escaping; a hostile value
    containing single quotes must appear in the rendered SQL as a properly
    escaped literal so the WHERE predicate remains well-formed and the DDL it
    purports to inject is inert.
    """

    def test_quote_in_value_is_escaped_as_literal(self):
        view = _make_view(
            columns=[_col("region", "ds1", "region", "text")],
            filters=[ViewFilter(source_ref="ds1", column="region", operator="=", value="'; DROP TABLE projects; --")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        # The injection payload must appear as a SINGLE quoted string literal
        # — single quotes inside escaped per SQL standard (``''``). The DROP
        # TABLE keyword therefore lives inside the string literal, not as a
        # SQL statement.
        assert "DROP TABLE" in sql, "payload must round-trip into the SQL"
        # The single quote in the payload must appear as the doubled escape;
        # if the renderer interpolated the value naively the WHERE clause
        # would close the literal at the first quote and execute the rest.
        assert "''; DROP TABLE projects; --" in sql, (
            "single quote must be SQL-escaped to '' inside the literal so the WHERE clause is well-formed"
        )

    def test_quote_in_value_does_not_break_sql_structure(self):
        view = _make_view(
            columns=[_col("region", "ds1", "region", "text")],
            filters=[ViewFilter(source_ref="ds1", column="region", operator="=", value="'; DROP TABLE projects; --")],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        # The number of single quotes must be even — odd count means the
        # literal is unterminated and the payload escaped the string layer.
        assert sql.count("'") % 2 == 0, (
            f"odd number of single quotes in rendered SQL — payload escaped the literal layer:\n{sql}"
        )


class TestOperatorRendering:
    """Every operator the analyst's filter tool surfaces renders to a
    well-formed SQL predicate without f-string interpolation of value.
    """

    @pytest.mark.parametrize(
        "operator,value,expected_in_sql",
        [
            ("=", "100", "= 100"),
            ("!=", "100", "<> 100"),
            (">", "50", "> 50"),
            (">=", "50", ">= 50"),
            ("<", "50", "< 50"),
            ("<=", "50", "<= 50"),
            ("LIKE", "open%", "LIKE 'open%'"),
        ],
    )
    def test_operator_renders_to_predicate(self, operator: str, value: str, expected_in_sql: str):
        col = "amount" if operator in {"=", "!=", ">", ">=", "<", "<="} else "status"
        display = "integer" if col == "amount" else "text"
        view = _make_view(
            columns=[_col(col, "ds1", col, display)],
            filters=[ViewFilter(source_ref="ds1", column=col, operator=operator, value=value)],
        )
        sql = ViewIbisCompiler().generate_executable(view)
        assert expected_in_sql in sql


class TestDiscriminatedUnionContract:
    """ViewFilter as a Pydantic discriminated union — malformed operators are
    rejected at the validation boundary BEFORE the compiler is reached.
    """

    def test_unknown_operator_is_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            parse_view_filter(
                {
                    "source_ref": "ds1",
                    "column": "region",
                    "operator": "DELETE_ALL",
                    "value": "x",
                }
            )
        # Pydantic raises ``union_tag_invalid`` for discriminated unions; the
        # discriminator field name (``operator``) is reported in the error
        # context, naming the rejected field unambiguously.
        errors = exc_info.value.errors()
        assert any(
            err.get("type") == "union_tag_invalid" and "operator" in str(err.get("ctx", {}).get("discriminator", ""))
            for err in errors
        ), errors

    def test_in_value_accepts_string_form(self):
        f = parse_view_filter({"source_ref": "ds1", "column": "status", "operator": "IN", "value": "(open, pending)"})
        assert f.value == ["open", "pending"]

    def test_in_value_accepts_list_form(self):
        f = parse_view_filter({"source_ref": "ds1", "column": "status", "operator": "IN", "value": ["open", "pending"]})
        assert f.value == ["open", "pending"]

    def test_numeric_comparison_value_is_coerced(self):
        f = parse_view_filter({"source_ref": "ds1", "column": "amount", "operator": ">", "value": "100"})
        assert f.value == 100

    def test_null_operator_requires_no_value(self):
        f = parse_view_filter({"source_ref": "ds1", "column": "name", "operator": "IS NULL", "value": None})
        assert f.value is None


class TestDeprecationShim:
    """``ViewSQLGenerator`` is the deprecation shim retained per ADR-026
    §"First MR shape" for one release while controllers migrate. Verify the
    contract: the shim delegates to ``ViewIbisCompiler`` and warns on use.
    """

    def test_instantiating_shim_emits_deprecation_warning(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            ViewSQLGenerator()
        assert any(issubclass(w.category, DeprecationWarning) and "ViewIbisCompiler" in str(w.message) for w in caught)

    def test_shim_executable_matches_compiler_executable(self):
        view = _make_view(columns=[_col("id", "ds1", "id", "text")])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            shim_sql = ViewSQLGenerator().generate_executable(view)
        direct_sql = ViewIbisCompiler().generate_executable(view)
        assert shim_sql == direct_sql
