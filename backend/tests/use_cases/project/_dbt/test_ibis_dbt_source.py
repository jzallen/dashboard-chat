"""Unit tests for the ibis dbt-source plugin (ADR-026 MR-2).

The plugin module at ``app.use_cases.project._dbt.ibis_dbt_source`` provides:

* ``IbisDbtRefDuckDBCompiler`` — a DuckDB compiler subclass that emits
  ``{{ ref('<dbt_model_name>') }}`` macros directly during sqlglot
  serialization for unbound source tables (the structured-columns path).
* ``render_view_with_dbt_refs(view)`` — convenience wrapper used by
  ``ViewIbisCompiler.generate_executable(view, ref_mode=True)``. Renders a
  ``View`` aggregate through the plugin compiler with the view's
  ``source_refs`` driving the name→macro mapping.

These tests exercise the plugin DIRECTLY at the module's public API,
independent of ``ViewIbisCompiler``. The byte-faithfulness contract with
the legacy ``_rewrite_sources_to_dbt_refs`` regex output is pinned by the
characterization tests in ``test_intermediate_dbt_ref_characterization.py``.
"""

from __future__ import annotations

import ibis
import pytest

from app.use_cases.project._dbt.ibis_dbt_source import (
    IbisDbtRefDuckDBCompiler,
    render_view_with_dbt_refs,
)


class TestIbisDbtRefDuckDBCompilerEmitsMacrosDirectly:
    """The plugin's visit_UnboundTable emits a {{ ref('...') }} macro in place
    of the quoted identifier, BYPASSING the legacy post-render regex."""

    def test_single_unbound_table_renders_as_dbt_ref_macro(self):
        """An ibis.table named 'orders' compiles to a SQL string whose FROM
        clause is the dbt macro, not the bare quoted identifier."""
        orders = ibis.table({"order_id": "string"}, name="orders")
        expr = orders.select(orders.order_id)

        compiler = IbisDbtRefDuckDBCompiler(
            ref_name_map={"orders": "stg_orders"},
        )
        sql = compiler.render(expr)

        assert "{{ ref('stg_orders') }}" in sql
        assert '"orders"' not in sql

    def test_join_renders_both_tables_as_dbt_ref_macros(self):
        """Joins must emit BOTH source tables as macros, with no bare quoted
        identifiers surviving anywhere in the rendered SQL."""
        orders = ibis.table({"customer_id": "string", "total": "float64"}, name="orders")
        customers = ibis.table({"id": "string", "name": "string"}, name="customers")
        expr = orders.join(customers, orders.customer_id == customers.id).select(orders.total, customers.name)

        compiler = IbisDbtRefDuckDBCompiler(
            ref_name_map={"orders": "stg_orders", "customers": "int_customers"},
        )
        sql = compiler.render(expr)

        assert "{{ ref('stg_orders') }}" in sql
        assert "{{ ref('int_customers') }}" in sql
        assert '"orders"' not in sql
        assert '"customers"' not in sql

    def test_filter_literal_is_escaped_through_ibis_not_string_interpolation(self):
        """Per DWD-4: the closure mechanism is ibis literal escaping. A hostile
        filter value reaches the rendered SQL as an escaped SQL literal, not
        as embedded SQL syntax."""
        orders = ibis.table({"region": "string"}, name="orders")
        expr = orders.filter(orders.region == "'; DROP TABLE projects; --").select(orders.region)

        compiler = IbisDbtRefDuckDBCompiler(
            ref_name_map={"orders": "stg_orders"},
        )
        sql = compiler.render(expr)

        # Macro emitted by the plugin (not regex).
        assert "{{ ref('stg_orders') }}" in sql
        # The injection payload becomes a quoted string literal — single quotes doubled.
        assert "'''; DROP TABLE projects; --'" in sql

    def test_unmapped_source_name_falls_back_to_the_raw_name_in_the_macro(self):
        """If a source table's name has no entry in ref_name_map, the plugin
        emits a macro using the raw name. Preserves the legacy regex's
        behavior of leaving unmapped sources visibly broken (rather than
        silently dropping the FROM clause)."""
        unknown = ibis.table({"x": "string"}, name="unknown_source")
        expr = unknown.select(unknown.x)

        compiler = IbisDbtRefDuckDBCompiler(ref_name_map={})
        sql = compiler.render(expr)

        # Fallback: raw name appears inside the macro.
        assert "{{ ref('unknown_source') }}" in sql


class TestRenderViewWithDbtRefs:
    """The render_view_with_dbt_refs(view) wrapper consumes a View aggregate,
    builds the per-source ref_name_map from view.source_refs (snake-case +
    stg_/int_ prefix per source type), and renders through the plugin
    compiler."""

    def test_returns_sql_with_dbt_ref_macro_for_dataset_source(self):
        from app.models.view import DisplayType, View, ViewColumn

        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="Customer Summary",
            sql_definition="",
            source_refs=[{"id": "ds-1", "name": "orders", "type": "dataset"}],
            columns=[
                ViewColumn(
                    name="order_id",
                    source_ref="ds-1",
                    source_column="order_id",
                    display_type=DisplayType.id,
                ),
            ],
            materialization="ephemeral",
        )

        sql = render_view_with_dbt_refs(view)

        assert "{{ ref('stg_orders') }}" in sql
        assert '"orders"' not in sql

    def test_returns_sql_with_int_prefix_for_view_source(self):
        from app.models.view import DisplayType, View, ViewColumn

        view = View(
            id="view-1",
            project_id="proj-1",
            org_id="org-1",
            name="Aggregated",
            sql_definition="",
            source_refs=[{"id": "view-2", "name": "customer_summary", "type": "view"}],
            columns=[
                ViewColumn(
                    name="cid",
                    source_ref="view-2",
                    source_column="customer_id",
                    display_type=DisplayType.id,
                ),
            ],
            materialization="ephemeral",
        )

        sql = render_view_with_dbt_refs(view)

        assert "{{ ref('int_customer_summary') }}" in sql
        assert '"customer_summary"' not in sql


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
