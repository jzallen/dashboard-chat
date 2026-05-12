"""Tests for ReportIbisCompiler (ADR-026 MR-3 / Phase 03-01).

The compiler is a pure builder: it consumes ``source_refs``, ``columns_metadata``
(carrying ``role=dimension`` + ``role=measure`` entries), and a per-source
schema (column dtypes), and emits DuckDB-dialect SQL via
``ibis.Table.group_by(dims).aggregate(measures)`` + ``ibis.to_sql(dialect="duckdb")``.

Tests assert customer-visible contracts (the rendered SQL contains the expected
GROUP BY + aggregation expressions) rather than ibis-internal call sequences.
Per ADR-026 DWD-4: literal escaping is verified by construction — single-quoted
payloads round-trip through ibis without f-string interpolation.
"""

from __future__ import annotations

import re

import pytest

from app.use_cases.report.report_ibis_compiler import ReportIbisCompiler

_ORDERS_REF = [{"id": "ds-orders", "type": "dataset", "name": "orders"}]
_ORDERS_SCHEMA = {
    "ds-orders": {
        "region": "string",
        "quarter": "string",
        "amount": "float64",
        "order_id": "string",
    }
}


def _normalize(sql: str) -> str:
    return " ".join(sql.split()).lower()


class TestGenerateExecutable:
    def test_one_dimension_and_one_count_measure_emit_group_by_and_count(self) -> None:
        cols = [
            {
                "name": "region",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": "region",
                "source_ref": "ds-orders",
            },
            {
                "name": "order_count",
                "semantic_role": "measure",
                "semantic_type": "count",
                "source_column": "order_id",
                "source_ref": "ds-orders",
            },
        ]
        sql = ReportIbisCompiler().generate_executable(
            source_refs=_ORDERS_REF,
            columns_metadata=cols,
            schema=_ORDERS_SCHEMA,
        )
        flat = _normalize(sql)
        assert "group by" in flat, sql
        assert '"region"' in sql.lower(), sql
        assert "count(" in flat and "order_id" in flat, sql
        assert "from" in flat and '"orders"' in sql.lower(), sql

    @pytest.mark.parametrize(
        ("semantic_type", "expected_fragment", "source_column"),
        [
            ("sum", "sum(", "amount"),
            ("count", "count(", "order_id"),
            ("count_distinct", "count(distinct", "order_id"),
            ("avg", "avg(", "amount"),
            ("min", "min(", "amount"),
            ("max", "max(", "amount"),
        ],
    )
    def test_every_measure_semantic_type_compiles_to_its_aggregation(
        self, semantic_type: str, expected_fragment: str, source_column: str
    ) -> None:
        cols = [
            {
                "name": "region",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": "region",
                "source_ref": "ds-orders",
            },
            {
                "name": f"{semantic_type}_of_{source_column}",
                "semantic_role": "measure",
                "semantic_type": semantic_type,
                "source_column": source_column,
                "source_ref": "ds-orders",
            },
        ]
        sql = ReportIbisCompiler().generate_executable(
            source_refs=_ORDERS_REF,
            columns_metadata=cols,
            schema=_ORDERS_SCHEMA,
        )
        flat = _normalize(sql)
        assert expected_fragment in flat, sql
        assert source_column in flat, sql

    def test_measure_name_becomes_output_alias(self) -> None:
        cols = [
            {
                "name": "region",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": "region",
                "source_ref": "ds-orders",
            },
            {
                "name": "headline_revenue",
                "semantic_role": "measure",
                "semantic_type": "sum",
                "source_column": "amount",
                "source_ref": "ds-orders",
            },
        ]
        sql = ReportIbisCompiler().generate_executable(
            source_refs=_ORDERS_REF,
            columns_metadata=cols,
            schema=_ORDERS_SCHEMA,
        )
        # The output column name appears as an alias in the SELECT projection.
        assert '"headline_revenue"' in sql, sql

    def test_compiler_source_contains_no_sql_identifier_fstring_interpolation(self) -> None:
        """ADR-026 DWD-4 invariant: the compiler MUST NOT use f-string
        interpolation to build SQL identifiers or string literals.

        The forbidden shapes are the ones that produce a live injection
        vector when an attacker controls the interpolated value:

        * ``f'"{column}"'``     — double-quoted SQL identifier
        * ``f"'{value}'"``      — single-quoted SQL string literal
        * ``f"`{column}`"``     — backtick-quoted SQL identifier
        * ``f' FROM {table} '`` — bare interpolation into a SQL fragment

        f-strings in Python exception messages are NOT a SQL injection
        vector — those interpolate into ``raise ValueError(...)``, never
        into rendered SQL — so this check intentionally permits them.

        The check is static: any future regression that reintroduces an
        identifier- or literal-interpolating f-string in the compiler source
        is caught here, BEFORE it has a chance to land a live vector.
        """
        from pathlib import Path

        candidates = [
            Path(__file__).parent.parent.parent.parent / "app/use_cases/report/report_ibis_compiler.py",
        ]
        source_path = next((c for c in candidates if c.exists()), None)
        assert source_path is not None, f"could not find compiler source on disk; tried {candidates}"

        source = source_path.read_text()
        # Strip docstrings and #-comments so the check targets executable code.
        without_docstrings = re.sub(r'"""[\s\S]*?"""', "", source)
        without_docstrings = re.sub(r"'''[\s\S]*?'''", "", without_docstrings)
        executable_lines = []
        for line in without_docstrings.splitlines():
            stripped = line.split("#", 1)[0]
            if stripped.strip():
                executable_lines.append(stripped)
        executable = "\n".join(executable_lines)

        # The dangerous shapes: f-strings whose interpolation sits between
        # SQL-quoting characters (double-quote, single-quote, backtick) or
        # immediately after a SQL keyword that consumes an identifier
        # (FROM / JOIN / TABLE / SELECT).
        dangerous_patterns = [
            r'''[fF]"[^"]*"[^"]*\{[^}]+\}[^"]*"[^"]*"''',
            r"""[fF]'[^']*'[^']*\{[^}]+\}[^']*'[^']*""",
            r"""[fF]["']\s*`[^`]*\{[^}]+\}[^`]*`""",
            r"""[fF]["'][^"']*\b(?:FROM|JOIN|TABLE|SELECT)\s+\{[^}]+\}""",
        ]
        offenders: list[str] = []
        for pattern in dangerous_patterns:
            offenders.extend(re.findall(pattern, executable, flags=re.IGNORECASE))
        assert not offenders, (
            "ReportIbisCompiler source contains SQL-identifier f-string interpolation — "
            "DWD-4 violation. Identifiers must flow through ibis's expression API, never "
            f"through f-strings. Offending fragments: {offenders!r}"
        )

    def test_dimension_column_with_embedded_single_quote_renders_well_formed_sql(self) -> None:
        """ADR-026 Gap-2 closure: ibis literal escaping handles single-quote
        payloads by construction. The customer's choice of *column name* must
        not produce a SQL injection vector even when the name contains the
        same character SQL uses to terminate a string literal.

        We assert the resulting SQL is well-formed by counting paired quotes
        rather than asserting a specific escape sequence — the contract is
        "ibis handles it," not a specific render shape.
        """
        weird_column = "region'); DROP TABLE orders; --"
        schema = {"ds-orders": {weird_column: "string", "order_id": "string"}}
        cols = [
            {
                "name": "weird_dim",
                "semantic_role": "dimension",
                "semantic_type": "categorical",
                "source_column": weird_column,
                "source_ref": "ds-orders",
            },
            {
                "name": "order_count",
                "semantic_role": "measure",
                "semantic_type": "count",
                "source_column": "order_id",
                "source_ref": "ds-orders",
            },
        ]
        sql = str(
            ReportIbisCompiler().generate_executable(
                source_refs=_ORDERS_REF,
                columns_metadata=cols,
                schema=schema,
            )
        )
        # Well-formedness: identifier-quote characters (") MUST be balanced
        # — every opening quote has a closing partner. Ibis uses ``"`` as
        # the DuckDB identifier delimiter; a balanced count is the
        # structural invariant that proves the embedded single-quote did NOT
        # terminate an identifier mid-stream.
        assert sql.count('"') % 2 == 0, sql

        # Gap-2 contract: the column name reaches the rendered SQL as a
        # single ibis-emitted identifier token (DuckDB escapes embedded
        # double-quotes by doubling them — ``"foo""bar"``). Since our
        # weird column contains no embedded ``"`` the literal form passes
        # through unchanged, but it MUST appear inside a ``"…"`` identifier
        # span — not adjacent to bare SQL keywords.
        expected_identifier = '"' + weird_column.replace('"', '""') + '"'
        assert expected_identifier in sql, (
            "embedded payload column name was NOT rendered as an ibis identifier — Gap-2 closure broken:\n" + sql
        )

        # Defense in depth: the dangerous suffix ``DROP TABLE`` must appear
        # ONLY inside the quoted identifier span — never as bare SQL.
        # Counting double-quoted spans that contain ``DROP TABLE`` and
        # comparing to total occurrences gives us that contract.
        total_drop_table = sql.upper().count("DROP TABLE")
        in_identifier = sum(1 for token in re.findall(r'"(?:[^"]|"")*"', sql) if "DROP TABLE" in token.upper())
        assert total_drop_table == in_identifier, (
            "DROP TABLE appears outside a quoted identifier span — Gap-2 closure broken:\n" + sql
        )
