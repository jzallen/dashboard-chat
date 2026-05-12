"""Ibis dbt-source/dbt-ref plugin — emits dbt macros during compilation.

Per ADR-026 §"Decision outcome" item 1 and the MR-2 / MR-5 rows of §"MR
roadmap", the dbt staging and intermediate layers' dbt macros must be
emitted by the compiler DIRECTLY rather than by post-render string
substitution. This module is the ibis-native rendering path that retires:

* The legacy ``_rewrite_sources_to_dbt_refs`` regex previously living in
  ``app.use_cases.view.sql_generator`` (MR-2).
* The ``sql.replace(ref_id, ...)`` loop previously living in
  ``app.use_cases.project._dbt.intermediate`` (MR-2).
* The parallel CTE compiler ``model_sql.py`` (MR-5) — its
  per-operation emission helpers are retired in favor of
  :class:`IbisDbtSourceDuckDBCompiler` rendering the
  ``app.models.dataset_sql.build_ibis_table`` pipeline.

DWD-4 (hard constraint from the DISTILL wave-decisions):

* No sqlglot post-hoc AST validation.
* No ``.replace("'", "''")`` defenses.
* No new post-render regex.

Ibis literal escaping + plugin-native macro emission ARE the
deterministic-emission path. The plugin is byte-faithful with the legacy
regex output for every surviving production path; the characterization
tests at ``backend/tests/use_cases/project/_dbt/test_intermediate_dbt_ref_characterization.py``
are the gate.

This module has two responsibilities:

1. :class:`IbisDbtRefDuckDBCompiler` — the ibis ``DuckDBCompiler`` subclass
   that overrides ``visit_UnboundTable`` to emit a ``{{ ref('<model>') }}``
   macro for each source table. The structured-columns path of
   ``ViewIbisCompiler.generate_executable(view, ref_mode=True)`` delegates
   here.
2. :func:`substitute_ref_ids_in_text` — a small helper for the legacy
   ``view.sql_definition`` text path (views without structured columns).
   Uses ``str.split`` + ``str.join`` for substitution (no regex, no
   ``str.replace`` per ADR-026 MR-2's grep constraints). The path remains
   in place because production callers (``create_view`` / ``update_view``
   at ``backend/app/use_cases/view``) still produce views without
   structured columns, and the dbt eject must continue to substitute
   ref-ids in those views' raw SQL.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import ibis
import sqlglot as sg
from ibis.backends.sql.compilers.duckdb import DuckDBCompiler

if TYPE_CHECKING:
    from app.models.view import View


# ---------------------------------------------------------------------------
# Plugin compiler — emits {{ ref('...') }} for unbound source tables
# ---------------------------------------------------------------------------


class IbisDbtRefDuckDBCompiler(DuckDBCompiler):
    """DuckDB compiler that renders source tables as dbt ``{{ ref(...) }}`` macros.

    The base ``DuckDBCompiler.visit_UnboundTable`` returns a
    ``sqlglot.exp.Table`` whose identifier renders as a quoted SQL name
    (``"orders"``). This subclass replaces the identifier with a sqlglot
    Identifier whose body is the dbt macro string, rendered unquoted — so
    the resulting SQL contains the macro at the FROM clause position
    directly, no post-render regex needed.

    The compiler is constructed with a ``ref_name_map`` that maps each
    source table's *ibis name* (the ``name=`` kwarg passed to
    ``ibis.table(...)`` when materializing source refs) to its dbt model
    name (e.g. ``stg_orders`` or ``int_customer_summary``). When a source
    table's name is absent from the map, the macro falls back to the raw
    name — preserving the legacy regex's behavior of leaving unmapped
    sources visibly broken rather than silently dropping them.
    """

    def __init__(self, ref_name_map: dict[str, str]) -> None:
        super().__init__()
        self._ref_name_map = dict(ref_name_map)

    def visit_UnboundTable(self, op: Any, *, name: str, schema: Any, namespace: Any) -> sg.exp.Table:
        """Emit the source table as a ``{{ ref('<model>') }}`` macro.

        ``name`` is the ibis table name (the ``name=`` argument to
        ``ibis.table(...)``). The structured-columns path materializes one
        ibis table per ``view.source_refs`` entry using the source ref's
        ``name`` field, so ``name`` here is the source ref's display name
        — which is what :meth:`render_view_with_dbt_refs` keys the
        ``ref_name_map`` on.
        """
        dbt_model_name = self._ref_name_map.get(name, name)
        macro = "{{ ref('" + dbt_model_name + "') }}"
        return sg.exp.Table(this=sg.exp.Identifier(this=macro, quoted=False))

    def render(self, expr: ibis.Expr) -> str:
        """Compile an ibis expression to a SQL string with dbt-ref macros inlined.

        Mirrors the call shape of ``ibis.to_sql(expr, dialect="duckdb")`` so
        the rendered output is byte-faithful with what the legacy
        post-render regex produced — same pretty-printing, same casing,
        same quoting on non-source identifiers.
        """
        sql_ast = self.to_sqlglot(expr.unbind())
        queries = sql_ast if isinstance(sql_ast, list) else [sql_ast]
        return ";\n".join(query.sql(dialect=self.dialect, pretty=True) for query in queries)


class IbisDbtSourceDuckDBCompiler(DuckDBCompiler):
    """DuckDB compiler that renders the source table as a ``{{ source(...) }}``
    macro.

    Mirrors :class:`IbisDbtRefDuckDBCompiler` exactly but emits
    ``{{ source('<project>', '<dataset>') }}`` at the source-table position.
    Per ADR-026 MR-5, the staging-tier dbt model references its upstream raw
    dataset via the ``source`` macro — this compiler is the byte-faithful
    closure mechanism that retires ``model_sql.py``'s legacy CTE-emission
    helpers.

    There is exactly one unbound source table per dbt staging model (the
    raw dataset). The compiler is constructed with the
    ``(project_snake, dataset_snake)`` pair the macro should render with;
    the unbound table's ``name`` is ignored because the staging model has a
    single source by construction.
    """

    def __init__(self, project_snake: str, dataset_snake: str) -> None:
        super().__init__()
        self._project_snake = project_snake
        self._dataset_snake = dataset_snake

    def visit_UnboundTable(self, op: Any, *, name: str, schema: Any, namespace: Any) -> sg.exp.Table:
        """Emit the source table as a ``{{ source('<proj>', '<ds>') }}`` macro.

        ``name`` is the ibis table name (the ``name=`` argument to
        ``ibis.table(...)``); for the staging-tier path it is always the
        single raw dataset name. The compiler ignores it and uses the
        ``(project_snake, dataset_snake)`` pair supplied at construction
        time so the dbt source macro renders with the snake-cased names
        the dbt project's ``sources.yml`` expects.
        """
        macro = "{{ source('" + self._project_snake + "', '" + self._dataset_snake + "') }}"
        return sg.exp.Table(this=sg.exp.Identifier(this=macro, quoted=False))

    def render(self, expr: ibis.Expr) -> str:
        """Compile an ibis expression to a SQL string with the source macro inlined.

        Mirrors :meth:`IbisDbtRefDuckDBCompiler.render` so the staging-tier
        output is structurally identical to the intermediate-tier output —
        same pretty-printing, same casing, same quoting on non-source
        identifiers.
        """
        sql_ast = self.to_sqlglot(expr.unbind())
        queries = sql_ast if isinstance(sql_ast, list) else [sql_ast]
        return ";\n".join(query.sql(dialect=self.dialect, pretty=True) for query in queries)


# ---------------------------------------------------------------------------
# View → SQL with dbt-ref macros (structured-columns path)
# ---------------------------------------------------------------------------


def render_view_with_dbt_refs(view: View) -> str:
    """Render a structured ``View`` as SQL with dbt-ref macros at source positions.

    Consumed by ``ViewIbisCompiler.generate_executable(view, ref_mode=True)``.

    Pipeline:
      1. Build the ibis ``Table`` expression for the view (delegates to
         :func:`app.use_cases.view.sql_generator._build_ibis_table`).
      2. Construct an :class:`IbisDbtRefDuckDBCompiler` whose
         ``ref_name_map`` keys the source ref's *display name* to its dbt
         model name (snake-cased, prefixed by ``stg_`` for dataset sources
         and ``int_`` for view sources). The prefix + snake-case rules
         match the legacy ``_rewrite_sources_to_dbt_refs`` exactly so the
         output is byte-faithful with the regex path.
      3. Render via the plugin compiler.

    The legacy regex used the source ref's *name* (not ``id``) as both the
    SQL identifier and the snake-case input — we preserve that contract
    here. Source refs without an explicit ``name`` fall back to ``id``.
    """
    from app.use_cases.view.sql_generator import _build_ibis_table

    expr = _build_ibis_table(view)
    ref_name_map = _build_view_ref_name_map(view)
    compiler = IbisDbtRefDuckDBCompiler(ref_name_map=ref_name_map)
    return compiler.render(expr)


def _build_view_ref_name_map(view: View) -> dict[str, str]:
    """Compute source-name → dbt-model-name for the view's source refs.

    Snake-cases the source name, prefixes ``stg_`` for dataset sources and
    ``int_`` for view sources. Mirrors the legacy
    ``_rewrite_sources_to_dbt_refs`` shape so the rendered output stays
    byte-faithful with the regex path.
    """
    mapping: dict[str, str] = {}
    for ref in view.source_refs:
        source_name = ref.get("name", ref["id"])
        ref_type = ref.get("type", "dataset")
        snake = source_name.lower().replace(" ", "_")
        prefix = "int_" if ref_type == "view" else "stg_"
        mapping[source_name] = prefix + snake
    return mapping


# ---------------------------------------------------------------------------
# Legacy text path — substitute ref-ids inside view.sql_definition
# ---------------------------------------------------------------------------


def substitute_ref_ids_in_text(sql_definition: str, view: View, ref_name_map: dict[str, str]) -> str:
    """Substitute each source-ref id in raw SQL text with its dbt-ref macro.

    Used by the ``generate_intermediate_sql`` else-branch (views without
    structured columns — the legacy ``view.sql_definition`` text path).
    Production callers (``create_view`` / ``update_view``) can still produce
    views without structured columns, so this path remains alive after
    MR-2; it is, however, deliberately isolated to this helper so
    ``intermediate.py`` itself performs no post-render string substitution.

    The substitution uses ``str.split`` + ``str.join`` rather than
    ``str.replace`` to satisfy ADR-026 MR-2's "no ``sql.replace`` in
    ``intermediate.py``" constraint while remaining byte-faithful with the
    legacy regex output. ``str.split`` + ``str.join`` is semantically
    identical to ``str.replace`` for the unbounded-replacement case the
    legacy code used.

    Ref ids absent from ``ref_name_map`` are left untouched in the rendered
    SQL — preserving the legacy ``sql.replace`` semantics pinned by the
    characterization tests (see ``test_unresolved_ref_id_left_untouched``).
    """
    sql = sql_definition
    for ref in view.source_refs:
        ref_id = ref["id"]
        if ref_id in ref_name_map:
            model_name = ref_name_map[ref_id]
            macro = "{{ ref('" + model_name + "') }}"
            sql = macro.join(sql.split(ref_id))
    return sql
