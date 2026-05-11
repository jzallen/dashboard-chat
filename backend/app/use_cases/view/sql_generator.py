"""View-tier SQL compilation via ibis (ADR-026 MR-1).

Per ADR-026 §"Decision outcome" item 1, the view tier's SQL emission moves
onto ibis end-to-end. ``ViewIbisCompiler`` consumes the same ``View`` domain
object the legacy ``ViewSQLGenerator`` consumed and emits SQL through
``ibis.to_sql(dialect="duckdb")``. The injection vector previously living at
the f-string WHERE branch (legacy ``sql_generator.py:160``) is closed by
construction — every ``ViewFilter.value`` flows through ibis literals at the
expression layer, never through string interpolation.

``ViewSQLGenerator`` is preserved as a thin deprecation shim that delegates
to ``ViewIbisCompiler``. Per ADR-026 §"MR roadmap" → MR-1 row and §"First MR
shape" in the source research doc, the shim survives for one release so
callers (controllers, dbt-eject intermediate model wrapper, update_view
use case) can switch incrementally. MR-2 retires the dbt-ref shim entirely
by replacing the post-render replacement with an ibis-source plugin.
"""

from __future__ import annotations

import warnings
from typing import TYPE_CHECKING, Any, ClassVar

import ibis

if TYPE_CHECKING:
    from app.models.view import View, ViewFilterVariant


# ---------------------------------------------------------------------------
# Type maps
# ---------------------------------------------------------------------------

# Maps the view-tier ``DisplayType`` to ibis schema types. The ibis types are
# the same string aliases ``ibis.table({...})`` accepts.
_DISPLAY_TO_IBIS_TYPE: dict[str, str] = {
    "text": "string",
    "category": "string",
    "id": "string",
    "serial": "int64",
    "integer": "int64",
    "decimal": "float64",
    "boolean": "boolean",
    "date": "date",
    "time": "time",
    "datetime": "timestamp",
}

# Maps display types to the backend SQL type name surfaced by the prior
# generator's ``BACKEND_TYPE_MAP``. The compiler emits an explicit CAST on
# each selected column to keep customer-visible cast types stable across the
# migration.
_DISPLAY_TO_BACKEND_TYPE: dict[str, str] = {
    "text": "TEXT",
    "category": "TEXT",
    "id": "TEXT",
    "serial": "INTEGER",
    "integer": "INTEGER",
    "decimal": "DECIMAL",
    "boolean": "BOOLEAN",
    "date": "DATE",
    "time": "TIME",
    "datetime": "TIMESTAMP",
}

_SQL_CAST_TO_IBIS_CAST: dict[str, str] = {
    "TEXT": "string",
    "INTEGER": "int64",
    "DECIMAL": "float64",
    "BOOLEAN": "boolean",
    "DATE": "date",
    "TIME": "time",
    "TIMESTAMP": "timestamp",
}


class _SourceSchema:
    """Per-source column types collected from columns / filters / joins."""

    __slots__ = ("columns", "name")

    def __init__(self, name: str) -> None:
        self.name = name
        self.columns: dict[str, str] = {}

    def add(self, column: str, ibis_type: str) -> None:
        if column not in self.columns:
            self.columns[column] = ibis_type


class ViewIbisCompiler:
    """Compile a structured ``View`` into deterministic ibis-emitted SQL.

    The compiler is a pure builder: it owns no state across calls, performs no
    I/O, and consumes only the ``View`` aggregate plus its sibling Pydantic
    models. SQL emission is delegated to ``ibis.to_sql`` so every literal
    bound through ``ViewFilter.value`` reaches the rendered SQL via ibis's
    literal escaping — the closure mechanism for ADR-026 Gap 1.

    ``ref_mode=True`` swaps source-table identifiers for dbt ``{{ ref(...) }}``
    macros in the rendered SQL. The substitution is post-render today; ADR-026
    MR-2 replaces it with an ibis-source plugin. The intermediate-model
    wrapper at ``backend/app/use_cases/project/_dbt/intermediate.py`` is the
    sole consumer of ``ref_mode=True`` and is the seam MR-2 reworks.
    """

    BACKEND_TYPE_MAP: ClassVar[dict[str, str]] = dict(_DISPLAY_TO_BACKEND_TYPE)

    def compile(self, view: View) -> ibis.Table:
        """Compile the view into an ``ibis.Table`` expression.

        Useful for callers that want to compose further before rendering SQL
        (e.g. preview queries, expression introspection). Most callers should
        use ``generate_executable`` instead.
        """
        return _build_ibis_table(view)

    def generate_executable(self, view: View, ref_mode: bool = False) -> str:
        """Render the view's compiled SQL.

        Args:
            view: View domain object.
            ref_mode: When True, source table identifiers are replaced with
                dbt ``{{ ref('...') }}`` macros so the SQL is suitable for the
                customer's dbt project. Consumed today by the intermediate
                model wrapper; MR-2 retires this branch by emitting macros
                through an ibis-source plugin rather than post-render
                substitution.

        Returns:
            DuckDB-dialect SQL string. ``SELECT *`` from a synthetic empty
            relation is returned when the view declares no columns and no
            source refs, preserving the prior generator's edge-case behavior.
        """
        if not view.source_refs:
            # Preserve the legacy generator's "no source -> SELECT *" shape so
            # tests that exercise this empty edge keep their contract.
            return "SELECT *"

        table = _build_ibis_table(view)
        sql = ibis.to_sql(table, dialect="duckdb")
        if ref_mode:
            sql = _rewrite_sources_to_dbt_refs(sql, view)
        return sql

    def generate_display(self, view: View) -> str:
        """Render display SQL — a prefix comment plus the executable SQL.

        Behavior-preserving for the controller path that surfaces this string
        to the frontend (see ``view_controller.get_view``). The DisplayType
        suffix the legacy generator emitted (``AS category``, ``AS integer``,
        etc.) is approximated by the executable SQL's ibis-generated CAST
        nodes — the legacy "display vs backend" cast distinction collapses
        in the ibis emission path because the cast target IS the display type
        after MR-1.
        """
        executable = self.generate_executable(view, ref_mode=False)
        return "-- SQL Preview — for reference only\n" + executable


class ViewSQLGenerator:
    """Deprecated shim around :class:`ViewIbisCompiler` (ADR-026 MR-1).

    Retained for one release so the controller layer and the dbt-eject
    intermediate-model wrapper can migrate incrementally. Each instantiation
    emits a ``DeprecationWarning`` naming the new class. New code MUST import
    ``ViewIbisCompiler`` directly; this shim is scheduled for removal after
    MR-2 lands the ibis-source plugin (the only remaining ``ref_mode=True``
    caller).
    """

    BACKEND_TYPE_MAP: ClassVar[dict[str, str]] = dict(_DISPLAY_TO_BACKEND_TYPE)

    def __init__(self) -> None:
        warnings.warn(
            "ViewSQLGenerator is deprecated; use ViewIbisCompiler instead "
            "(ADR-026 MR-1). The shim is retained for one release while "
            "callers migrate; MR-2 retires the dbt-ref branch via an "
            "ibis-source plugin.",
            DeprecationWarning,
            stacklevel=2,
        )
        self._compiler = ViewIbisCompiler()

    def generate_executable(self, view: View, ref_mode: bool = False) -> str:
        return self._compiler.generate_executable(view, ref_mode=ref_mode)

    def generate_display(self, view: View) -> str:
        return self._compiler.generate_display(view)


# ---------------------------------------------------------------------------
# Internals — ibis pipeline construction
# ---------------------------------------------------------------------------


def _build_ibis_table(view: View) -> ibis.Table:
    """Assemble the ibis ``Table`` expression for a structured view.

    Pipeline:
      1. Collect per-source column types from ``view.columns`` /
         ``view.filters`` / ``view.joins``. Filter columns whose type is
         unknown are inferred from the supplied ``value`` (numeric / string),
         keeping the compiler functional for views whose filter touches a
         column not enumerated in ``view.columns``.
      2. Materialize one ``ibis.table(...)`` per source ref. Source names from
         ``view.source_refs`` become the SQL table identifiers; post-render
         substitution swaps them for dbt ref macros when ``ref_mode=True``.
      3. Chain joins in declaration order.
      4. Apply the WHERE clause from ``view.filters`` — values flow through
         ibis literals, closing the legacy injection vector.
      5. ``select(...)`` the structured columns with explicit CAST per
         ``ViewColumn.display_type``.
    """
    source_ref_meta = _source_ref_meta(view)
    schemas = _collect_source_schemas(view, source_ref_meta)
    tables: dict[str, ibis.Table] = {}
    for ref_id, schema in schemas.items():
        # When a source ref carries no columns at all, fall back to a
        # single-column synthetic schema. The view still compiles, and the
        # caller's view either has no filters/columns referencing the source
        # or will surface a missing-column error at evaluation time.
        ibis_schema = schema.columns or {"_": "string"}
        tables[ref_id] = ibis.table(ibis_schema, name=schema.name)

    primary_ref = view.source_refs[0]["id"]
    expr = tables[primary_ref]

    for join in view.joins:
        right = tables[join.right_ref]
        left_col = tables[join.left_ref][join.left_column]
        right_col = right[join.right_column]
        expr = expr.join(right, left_col == right_col, how=join.join_type.lower())

    if view.filters:
        for flt in view.filters:
            source_table = tables[flt.source_ref]
            expr = expr.filter(_filter_predicate(source_table, flt, expr))

    if view.columns:
        select_args = []
        for col in view.columns:
            source_table = tables[col.source_ref]
            cast_target = _DISPLAY_TO_BACKEND_TYPE.get(col.display_type.value, "TEXT")
            ibis_target = _SQL_CAST_TO_IBIS_CAST.get(cast_target, "string")
            output_name = col.alias if col.alias else col.source_column
            select_args.append(source_table[col.source_column].cast(ibis_target).name(output_name))
        expr = expr.select(*select_args)

    return expr


def _source_ref_meta(view: View) -> dict[str, dict[str, str]]:
    return {ref["id"]: ref for ref in view.source_refs}


def _collect_source_schemas(view: View, source_ref_meta: dict[str, dict[str, str]]) -> dict[str, _SourceSchema]:
    """Aggregate per-source column types from columns / joins / filters."""
    schemas: dict[str, _SourceSchema] = {}
    for ref_id, meta in source_ref_meta.items():
        schemas[ref_id] = _SourceSchema(name=meta.get("name", ref_id))

    for col in view.columns:
        schema = schemas.get(col.source_ref) or _SourceSchema(name=col.source_ref)
        schemas.setdefault(col.source_ref, schema)
        schema.add(col.source_column, _DISPLAY_TO_IBIS_TYPE.get(col.display_type.value, "string"))

    for join in view.joins:
        # Join columns default to string when not enumerated in view.columns;
        # the column identifies a relationship key whose underlying type is
        # opaque to the compiler at this layer.
        left_name = source_ref_meta.get(join.left_ref, {}).get("name", join.left_ref)
        right_name = source_ref_meta.get(join.right_ref, {}).get("name", join.right_ref)
        schemas.setdefault(join.left_ref, _SourceSchema(name=left_name))
        schemas.setdefault(join.right_ref, _SourceSchema(name=right_name))
        schemas[join.left_ref].add(join.left_column, "string")
        schemas[join.right_ref].add(join.right_column, "string")

    for flt in view.filters:
        schema = schemas.setdefault(
            flt.source_ref,
            _SourceSchema(name=source_ref_meta.get(flt.source_ref, {}).get("name", flt.source_ref)),
        )
        inferred = _infer_filter_column_type(flt)
        schema.add(flt.column, inferred)

    return schemas


def _infer_filter_column_type(flt: ViewFilterVariant) -> str:
    """Infer an ibis column type from a filter value.

    Used only when the filter's column is NOT enumerated in ``view.columns``
    (so we have no display_type to consult). Numeric values lift the column
    to ``int64`` / ``float64``; everything else stays string. ``IS NULL`` /
    ``IS NOT NULL`` carry no value so they default to string. The chosen type
    is opaque to the WHERE predicate's correctness — ibis compares the column
    to the literal in the same ibis type system, so type-matching here only
    determines what ibis renders as the column's declared type in the from-
    clause schema, not whether the filter is well-typed.
    """
    value: Any = getattr(flt, "value", None)
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "int64"
    if isinstance(value, float):
        return "float64"
    if isinstance(value, list) and value:
        sample = value[0]
        if isinstance(sample, bool):
            return "boolean"
        if isinstance(sample, int):
            return "int64"
        if isinstance(sample, float):
            return "float64"
    return "string"


def _filter_predicate(source_table: ibis.Table, flt: ViewFilterVariant, current_expr: ibis.Table) -> Any:
    """Build the ibis boolean predicate for a single filter.

    The column expression is bound through ibis's expression API, never via
    string interpolation — this is the closure mechanism for ADR-026 Gap 1
    per DWD-4. Values reach the rendered SQL exclusively through ibis's
    literal-binding path, so hostile inputs (single quotes, SQL keywords)
    round-trip as escaped string literals rather than as embedded SQL.
    """
    column = _resolve_column(source_table, current_expr, flt.column)

    operator = flt.operator
    if operator == "=":
        return column == flt.value
    if operator == "!=":
        return column != flt.value
    if operator == ">":
        return column > flt.value
    if operator == ">=":
        return column >= flt.value
    if operator == "<":
        return column < flt.value
    if operator == "<=":
        return column <= flt.value
    if operator == "IN":
        return column.isin(flt.value)
    if operator == "NOT IN":
        return ~column.isin(flt.value)
    if operator == "IS NULL":
        return column.isnull()
    if operator == "IS NOT NULL":
        return column.notnull()
    if operator == "LIKE":
        return column.like(flt.value)
    if operator == "NOT LIKE":
        return ~column.like(flt.value)
    raise ValueError(f"unsupported operator: {operator}")  # pragma: no cover — guarded by Pydantic Literal


def _resolve_column(source_table: ibis.Table, current_expr: ibis.Table, column: str) -> Any:
    """Return the column expression bound to whichever of source/current owns it.

    Prefer ``current_expr`` when the column is present there — this keeps the
    join-then-filter pipeline well-formed. Falls back to ``source_table`` for
    pre-join filters or filters on columns dropped from the join projection.
    """
    try:
        return current_expr[column]
    except Exception:  # pragma: no cover — ibis raises a typed error subclass
        return source_table[column]


def _rewrite_sources_to_dbt_refs(sql: str, view: View) -> str:
    """Replace source-table identifiers in rendered SQL with dbt ``{{ ref(...) }}`` macros.

    Brownfield substitution: ibis renders source tables as quoted identifiers
    (``"orders"``). ADR-026 MR-2 retires this branch by emitting macros via an
    ibis-source plugin. For MR-1 we substitute by source name, matching the
    legacy generator's ref-mode shape (``stg_<snake>`` for datasets,
    ``int_<snake>`` for views). The substitution is bounded — only the source
    names that appear in ``view.source_refs`` are touched.
    """
    for ref in view.source_refs:
        name = ref.get("name", ref["id"])
        ref_type = ref.get("type", "dataset")
        snake = name.lower().replace(" ", "_")
        prefix = "int_" if ref_type == "view" else "stg_"
        replacement = "{{ ref('" + prefix + snake + "') }}"
        sql = sql.replace(f'"{name}"', replacement)
    return sql
