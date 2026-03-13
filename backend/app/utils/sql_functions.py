"""DuckDB SQL macro definitions and Ibis builtin UDF declarations.

UDF functions (title_case, snake_case, kebab_case) are lazily initialized
via module ``__getattr__`` so that ``import ibis`` is deferred until a UDF
is actually accessed. The macro SQL strings are plain strings and load
instantly.

Usage:
    from app.utils.sql_functions import register_duckdb_macros, title_case

    # Register macros on a DuckDB connection before querying
    register_duckdb_macros(conn)

    # Use UDFs in Ibis expressions
    expr = title_case(table.city)
"""

from __future__ import annotations

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


def register_duckdb_macros(conn) -> None:
    """Register all custom DuckDB macros on the given connection.

    Must be called before any query that uses title_case, snake_case,
    or kebab_case functions.
    """
    for macro_sql in ALL_MACROS:
        conn.raw_sql(macro_sql)


# ============================================================================
# Lazy Ibis Builtin UDF Declarations
# ============================================================================

_udfs: dict | None = None


def _init_udfs():
    import ibis

    @ibis.udf.scalar.builtin
    def title_case(s: str) -> str: ...

    @ibis.udf.scalar.builtin
    def snake_case(s: str) -> str: ...

    @ibis.udf.scalar.builtin
    def kebab_case(s: str) -> str: ...

    return {"title_case": title_case, "snake_case": snake_case, "kebab_case": kebab_case}


def __getattr__(name: str):
    global _udfs
    if name in ("title_case", "snake_case", "kebab_case"):
        if _udfs is None:
            _udfs = _init_udfs()
        return _udfs[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
