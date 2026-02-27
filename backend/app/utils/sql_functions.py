"""DuckDB SQL macro definitions and Ibis builtin UDF declarations.

Provides readable, named SQL functions for cleaning operations that lack
standard SQL equivalents. Each function is implemented as:

1. A DuckDB macro (CREATE OR REPLACE MACRO) for execution
2. An Ibis @udf.scalar.builtin declaration so Ibis emits the function name
   directly in generated SQL (e.g., `title_case(city)`) rather than expanding
   the macro body.

Usage:
    from app.utils.sql_functions import register_duckdb_macros, title_case

    # Register macros on a DuckDB connection before querying
    register_duckdb_macros(conn)

    # Use UDFs in Ibis expressions
    expr = title_case(table.city)
"""

import ibis

# ============================================================================
# DuckDB Macro SQL
# ============================================================================

TITLE_CASE_MACRO = """
CREATE OR REPLACE MACRO title_case(s) AS
    ARRAY_TO_STRING(
        LIST_TRANSFORM(
            STRING_SPLIT(TRIM(s), ' '),
            x -> CASE WHEN x = '' THEN '' ELSE UPPER(x[1]) || LOWER(x[2:]) END
        ),
        ' '
    )
"""

SNAKE_CASE_MACRO = """
CREATE OR REPLACE MACRO snake_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '_', 'g'), '_')
"""

KEBAB_CASE_MACRO = """
CREATE OR REPLACE MACRO kebab_case(s) AS
    TRIM(REGEXP_REPLACE(LOWER(TRIM(s)), '[^a-z0-9]+', '-', 'g'), '-')
"""

ALL_MACROS = [TITLE_CASE_MACRO, SNAKE_CASE_MACRO, KEBAB_CASE_MACRO]


def register_duckdb_macros(conn: ibis.BaseBackend) -> None:
    """Register all custom DuckDB macros on the given connection.

    Must be called before any query that uses title_case, snake_case,
    or kebab_case functions.
    """
    for macro_sql in ALL_MACROS:
        conn.raw_sql(macro_sql)


# ============================================================================
# Ibis Builtin UDF Declarations
# ============================================================================


@ibis.udf.scalar.builtin
def title_case(s: str) -> str: ...


@ibis.udf.scalar.builtin
def snake_case(s: str) -> str: ...


@ibis.udf.scalar.builtin
def kebab_case(s: str) -> str: ...
