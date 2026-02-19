"""Integration tests for DuckDB macros and Ibis builtin UDF declarations.

Tests register macros on a real DuckDB connection and verify edge case behavior.
"""

import pytest
import ibis

from app.utils.sql_functions import (
    register_duckdb_macros,
    title_case,
    snake_case,
    kebab_case,
)


@pytest.fixture
def duckdb_conn():
    """Create a DuckDB connection with macros registered."""
    conn = ibis.duckdb.connect()
    register_duckdb_macros(conn)
    return conn


def _eval(conn, expr):
    """Evaluate a scalar Ibis expression on DuckDB."""
    return conn.execute(expr)


# ============================================================================
# title_case macro
# ============================================================================


class TestTitleCaseMacro:
    def test_multi_word(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("san francisco")))
        assert result == "San Francisco"

    def test_leading_trailing_spaces(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("  hello  world  ")))
        assert result == "Hello  World"

    def test_mixed_case(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("jOHN dOE")))
        assert result == "John Doe"

    def test_already_title(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("Product Name")))
        assert result == "Product Name"

    def test_all_upper(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("FIRST NAME")))
        assert result == "First Name"

    def test_single_word(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("hello")))
        assert result == "Hello"

    def test_empty_string(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("")))
        assert result == ""

    def test_special_chars_preserved(self, duckdb_conn):
        result = _eval(duckdb_conn, title_case(ibis.literal("Product #1")))
        assert result == "Product #1"


# ============================================================================
# snake_case macro
# ============================================================================


class TestSnakeCaseMacro:
    def test_multi_word(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("Product Name")))
        assert result == "product_name"

    def test_all_upper(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("FIRST NAME")))
        assert result == "first_name"

    def test_already_snake(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("already_snake")))
        assert result == "already_snake"

    def test_special_chars(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("Product #1")))
        assert result == "product_1"

    def test_consecutive_spaces(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("hello   world")))
        assert result == "hello_world"

    def test_leading_trailing_whitespace(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("  hello  world  ")))
        assert result == "hello_world"

    def test_single_word(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("hello")))
        assert result == "hello"

    def test_empty_string(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("")))
        assert result == ""

    def test_hyphenated_input(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("already-kebab")))
        assert result == "already_kebab"

    def test_san_francisco(self, duckdb_conn):
        result = _eval(duckdb_conn, snake_case(ibis.literal("san francisco")))
        assert result == "san_francisco"


# ============================================================================
# kebab_case macro
# ============================================================================


class TestKebabCaseMacro:
    def test_multi_word(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("Product Name")))
        assert result == "product-name"

    def test_all_upper(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("FIRST NAME")))
        assert result == "first-name"

    def test_already_kebab(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("already-kebab")))
        assert result == "already-kebab"

    def test_special_chars(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("Product #1")))
        assert result == "product-1"

    def test_consecutive_spaces(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("hello   world")))
        assert result == "hello-world"

    def test_leading_trailing_whitespace(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("  hello  world  ")))
        assert result == "hello-world"

    def test_single_word(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("hello")))
        assert result == "hello"

    def test_empty_string(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("")))
        assert result == ""

    def test_underscore_input(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("already_snake")))
        assert result == "already-snake"

    def test_san_francisco(self, duckdb_conn):
        result = _eval(duckdb_conn, kebab_case(ibis.literal("san francisco")))
        assert result == "san-francisco"


# ============================================================================
# Ibis SQL output verification
# ============================================================================


class TestIbisSQLOutput:
    def test_title_case_in_sql(self, duckdb_conn):
        t = ibis.table({"city": "string"}, name="t")
        sql = str(ibis.to_sql(title_case(t.city), dialect="duckdb")).lower()
        assert "title_case(" in sql

    def test_snake_case_in_sql(self, duckdb_conn):
        t = ibis.table({"name": "string"}, name="t")
        sql = str(ibis.to_sql(snake_case(t.name), dialect="duckdb")).lower()
        assert "snake_case(" in sql

    def test_kebab_case_in_sql(self, duckdb_conn):
        t = ibis.table({"name": "string"}, name="t")
        sql = str(ibis.to_sql(kebab_case(t.name), dialect="duckdb")).lower()
        assert "kebab_case(" in sql
