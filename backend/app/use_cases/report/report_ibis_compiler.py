"""Report-tier SQL compilation via ibis (ADR-026 MR-3 / Phase 03-01).

Per ADR-026 §"Decision outcome" item 2 and §"MR roadmap" → MR-3, the report
tier compiles structured ``columns_metadata`` (dimensions + measures) into
``GROUP BY dim AGG(col)`` SQL through ibis end-to-end. ``ReportIbisCompiler``
is the pure builder behind the dispatcher; it consumes:

  * ``source_refs``     — wire-format source references the same shape the
    view-tier compiler consumes (``{"id", "type", "name"}``).
  * ``columns_metadata`` — semantic metadata with ``semantic_role`` of
    ``entity`` / ``dimension`` / ``measure`` and ``semantic_type`` matching
    the role's allowed type set (see
    :mod:`app.use_cases.report.column_validation`).
  * ``schema``          — per-source column dtypes (``{source_ref_id:
    {column: ibis_type}}``) supplied by the caller. The use-case wiring
    derives this from each source's ``schema_config``.

And emits DuckDB-dialect SQL via
``ibis.Table.group_by(dims).aggregate(measures)`` + ``ibis.to_sql(dialect="duckdb")``.

Per DWD-4 (HARD constraint): identifier references reach the rendered SQL
exclusively through ibis's expression API. The compiler MUST NOT use
f-string interpolation of column or table names; the unit-test suite enforces
this with a static-source check on this module.
"""

from __future__ import annotations

from typing import Any

import ibis

# Map ``semantic_type`` to the ibis column-aggregation method that emits the
# customer-visible aggregation expression. The mapping is closed: any new
# measure type added to :mod:`column_validation.VALID_TYPES_BY_ROLE` must
# also be added here (or the compiler raises).
_MEASURE_AGGREGATIONS = {
    "sum": "sum",
    "count": "count",
    "count_distinct": "nunique",
    "avg": "mean",
    "min": "min",
    "max": "max",
}


class ReportIbisCompiler:
    """Compile structured ``columns_metadata`` into ibis-emitted SQL.

    The compiler is a pure builder: it owns no state across calls, performs
    no I/O, and consumes only Python primitives plus the source schema. The
    return value is a DuckDB-dialect SQL string suitable for storage on a
    :class:`~app.models.report.Report` aggregate and for ejection into the
    customer's dbt mart layer.

    Closure mechanism (ADR-026 Gap 2): every column reference flows through
    ``getattr(table, source_column)`` and every aggregation flows through an
    ibis expression method. Customer-supplied identifiers — even hostile ones
    — round-trip as escaped identifiers in the rendered SQL because that is
    what ibis's expression API does by construction.
    """

    def generate_executable(
        self,
        *,
        source_refs: list[dict[str, Any]],
        columns_metadata: list[dict[str, Any]],
        schema: dict[str, dict[str, str]],
    ) -> str:
        """Render the report's compiled SQL.

        Args:
            source_refs: Wire-format source references; the first ref is the
                base relation. The compiler currently consumes a single
                source (the milestone-2 contract); multi-source composition
                lands with the milestone-3 join-aware step.
            columns_metadata: Semantic column metadata. Entries with
                ``semantic_role == "dimension"`` become GROUP BY columns;
                entries with ``semantic_role == "measure"`` become aggregated
                output columns. ``entity`` entries are surfaced as plain
                projections (no aggregation, no grouping).
            schema: Per-source column dtypes. ``schema[source_ref_id]`` is a
                ``{column_name: ibis_type}`` dict used to materialize the
                ibis base relation.

        Returns:
            DuckDB-dialect SQL string emitted by ``ibis.to_sql``.
        """
        if not source_refs:
            raise ValueError("ReportIbisCompiler.generate_executable requires at least one source ref")

        primary = source_refs[0]
        source_id = primary["id"]
        source_name = primary.get("name", source_id)
        column_dtypes = schema.get(source_id, {})

        # Construct the ibis base table. The schema dict drives the columns
        # ibis knows about — entries the report references but the schema
        # omits fall back to ``string`` so the compile-time call resolves
        # without exception. At evaluation time DuckDB surfaces missing
        # columns via its own typed error.
        ibis_schema = self._resolve_schema(column_dtypes, columns_metadata)
        table = ibis.table(ibis_schema, name=source_name)

        dimensions = [c for c in columns_metadata if c.get("semantic_role") == "dimension"]
        measures = [c for c in columns_metadata if c.get("semantic_role") == "measure"]

        if not dimensions and not measures:
            # Pure entity-only report — no aggregation. Fall through to a
            # straight projection so the compiler's contract stays defined.
            entity_select = [getattr(table, c["source_column"]).name(c["name"]) for c in columns_metadata]
            expr = table.select(*entity_select) if entity_select else table
            return ibis.to_sql(expr, dialect="duckdb")

        group_keys = [getattr(table, c["source_column"]).name(c["name"]) for c in dimensions]
        agg_kwargs = {c["name"]: self._build_aggregation(table, c) for c in measures}

        # Measures with no dimension is a single-row aggregate. The
        # use-case layer rejects this for reports per milestone-2's
        # error-semantics contract; the compiler still renders it so the
        # contract stays defined for future scalar-mart variants.
        expr = table.group_by(group_keys).aggregate(**agg_kwargs) if group_keys else table.aggregate(**agg_kwargs)
        return ibis.to_sql(expr, dialect="duckdb")

    @staticmethod
    def _resolve_schema(column_dtypes: dict[str, str], columns_metadata: list[dict[str, Any]]) -> dict[str, str]:
        """Materialize the ibis-schema dict for the base relation.

        Columns mentioned by ``columns_metadata`` get their dtype from the
        caller-supplied ``column_dtypes`` when present, falling back to
        ``string`` otherwise (the type-recovery path mirrors
        :mod:`app.use_cases.view.sql_generator`).
        """
        resolved: dict[str, str] = {}
        for col in columns_metadata:
            src = col.get("source_column") or col.get("name")
            if src is None:
                continue
            resolved[src] = column_dtypes.get(src, "string")
        if not resolved:
            # Synthetic single-column schema keeps ibis happy when the
            # report references no columns at all.
            return {"_": "string"}
        return resolved

    @staticmethod
    def _build_aggregation(table: ibis.Table, measure: dict[str, Any]) -> Any:
        """Build an ibis aggregation expression for a measure entry."""
        method_name = _MEASURE_AGGREGATIONS.get(measure["semantic_type"])
        if method_name is None:
            raise ValueError(
                f"unsupported measure semantic_type {measure['semantic_type']!r} on column {measure['name']!r}"
            )
        column_expr = getattr(table, measure["source_column"])
        agg_method = getattr(column_expr, method_name)
        return agg_method()
