"""Centralized SQL safety utilities for identifier quoting, validation, and sanitization.

Consolidates the separate implementations from bootstrap_sql, pg_duckdb_manager,
and lake/repository into a single well-tested module.
"""

import re

_SAFE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def quote_ident(name: str) -> str:
    """Double-quote a SQL identifier, escaping embedded double-quotes."""
    return '"' + name.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    """Single-quote a SQL literal, escaping embedded single-quotes."""
    return "'" + value.replace("'", "''") + "'"


def validate_identifier(name: str) -> str:
    """Validate name matches [A-Za-z_][A-Za-z0-9_]*. Raises ValueError if not."""
    if not _SAFE_IDENT_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


def sanitize_column_name(name: str) -> str:
    """Sanitize a column name for safe use as a SQL identifier.

    - Replaces characters outside [A-Za-z0-9_] with underscores
    - Prefixes with '_' if name starts with a digit
    - Raises ValueError if empty after sanitization
    """
    sanitized = re.sub(r"[^A-Za-z0-9_]", "_", name)
    # Collapse multiple underscores and strip trailing (but not leading yet)
    sanitized = re.sub(r"_+", "_", sanitized).rstrip("_")
    if sanitized and sanitized[0].isdigit():
        sanitized = f"_{sanitized}"
    if not sanitized:
        raise ValueError(f"Column name is empty after sanitization: {name!r}")
    return sanitized


def deduplicate_column_names(names: list[str]) -> list[str]:
    """Deduplicate column names by appending numeric suffixes.

    E.g., ["col_1", "col_1"] -> ["col_1", "col_1_2"]
    """
    seen: dict[str, int] = {}
    result = []
    for name in names:
        if name in seen:
            seen[name] += 1
            deduped = f"{name}_{seen[name]}"
            while deduped in seen:
                seen[name] += 1
                deduped = f"{name}_{seen[name]}"
            seen[deduped] = 1
            result.append(deduped)
        else:
            seen[name] = 1
            result.append(name)
    return result


_S3_ENDPOINT_RE = re.compile(r"^[A-Za-z0-9._-]+(:\d{1,5})?$")
_S3_KEY_RE = re.compile(r"^[A-Za-z0-9/+=]+$")


def validate_s3_endpoint(value: str) -> str:
    """Validate an S3/MinIO endpoint matches hostname:port format.

    Raises ValueError if the value could contain SQL injection payloads.
    """
    if not value or not _S3_ENDPOINT_RE.match(value):
        raise ValueError(f"Invalid S3 endpoint: {value!r}")
    return value


def validate_s3_key(value: str) -> str:
    """Validate an S3 access/secret key is alphanumeric.

    Raises ValueError if the value contains non-alphanumeric characters.
    """
    if not value or not _S3_KEY_RE.match(value):
        raise ValueError(f"Invalid S3 key: {value!r}")
    return value


def validate_condition_sql(sql: str) -> str:
    """Validate a condition SQL expression using sqlglot AST parsing.

    Ensures:
    - Single expression (no multiple statements)
    - No DDL/DML nodes (INSERT, UPDATE, DELETE, DROP, CREATE, ALTER)
    - No dangerous DuckDB function calls

    Raises ValueError if validation fails.
    """
    import sqlglot
    from sqlglot import exp

    sql = sql.strip()
    if not sql:
        raise ValueError("Empty condition SQL")

    # Reject multiple statements — semicolons indicate statement boundaries
    if ";" in sql:
        raise ValueError("Multiple SQL statements not allowed in condition SQL")

    try:
        parsed = sqlglot.parse_one(sql, error_level=sqlglot.ErrorLevel.IGNORE)
    except sqlglot.errors.ParseError as e:
        raise ValueError(f"Failed to parse condition SQL: {sql!r}") from e
    if parsed is None:
        raise ValueError(f"Failed to parse condition SQL: {sql!r}")

    # Reject DDL/DML nodes
    _FORBIDDEN_NODE_TYPES = (
        exp.Insert,
        exp.Update,
        exp.Delete,
        exp.Drop,
        exp.Create,
        exp.Alter,
        exp.Command,
    )
    for node in parsed.walk():
        if isinstance(node, _FORBIDDEN_NODE_TYPES):
            raise ValueError(f"Forbidden SQL operation in condition: {type(node).__name__}")

    # Reject dangerous DuckDB function calls
    _DANGEROUS_FUNCTIONS = frozenset(
        {
            "read_csv",
            "read_csv_auto",
            "read_parquet",
            "read_text",
            "read_json",
            "read_json_auto",
            "sniff_csv",
            "glob",
            "system",
            "copy",
            "attach",
            "install",
            "load",
        }
    )
    for node in parsed.walk():
        # sqlglot parses glob(...) as exp.Glob (the SQL GLOB operator), not as
        # a function call. Catch it explicitly so glob('/etc/passwd') is blocked.
        if isinstance(node, exp.Glob):
            raise ValueError("Dangerous function not allowed in condition SQL: glob")
        if isinstance(node, (exp.Anonymous, exp.Func)):
            func_name = ""
            if isinstance(node, exp.Anonymous):
                func_name = node.name.lower()
            elif hasattr(node, "sql_name"):
                func_name = node.sql_name().lower()
            if func_name in _DANGEROUS_FUNCTIONS:
                raise ValueError(f"Dangerous function not allowed in condition SQL: {func_name}")

    return sql
