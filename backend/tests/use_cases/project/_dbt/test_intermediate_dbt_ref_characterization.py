"""Characterization tests for dbt-ref macro emission (ADR-026 MR-2 prep).

These tests pin the BYTE-FAITHFUL behavior of the two post-render dbt-ref
substitution sites that MR-2 will retire:

  1. ``ViewIbisCompiler.generate_executable(view, ref_mode=True)`` which calls
     ``_rewrite_sources_to_dbt_refs(sql, view)`` after ibis renders the SQL
     (``backend/app/use_cases/view/sql_generator.py:_rewrite_sources_to_dbt_refs``).
  2. The ``else`` branch of ``generate_intermediate_sql`` which performs
     ``sql.replace(ref_id, "{{ ref('<model>') }}")`` against the raw
     ``view.sql_definition`` text
     (``backend/app/use_cases/project/_dbt/intermediate.py``).

Per CLAUDE.md brownfield discipline (Feathers characterization-before-refactor),
these tests are written BEFORE the legacy regex is replaced by the ibis-source
plugin in step 02-02. They MUST stay green when run against the new plugin —
they are the byte-faithfulness gate for that swap.

Assertions are byte-faithful: exact ``{{ ref('...') }}`` substrings and exact
macro positions where possible, not loose ``'ref' in sql`` containment.
"""

from __future__ import annotations

import pytest

from app.models.view import (
    DisplayType,
    View,
    ViewColumn,
    ViewFilter,
    ViewJoin,
)
from app.use_cases.project._dbt.intermediate import generate_intermediate_sql
from app.use_cases.view.sql_generator import ViewIbisCompiler

# ---------------------------------------------------------------------------
# Section A — structured-columns ref_mode=True path
# ViewIbisCompiler.generate_executable(view, ref_mode=True) routes through
# _rewrite_sources_to_dbt_refs which snake-cases the source NAME (not id),
# selects prefix by source type ("stg_" for dataset, "int_" for view), and
# replaces the double-quoted identifier ibis renders.
# ---------------------------------------------------------------------------


def _structured_view(
    *,
    name: str,
    source_refs: list[dict[str, str]],
    columns: list[ViewColumn],
    joins: list[ViewJoin] | None = None,
    filters: list | None = None,
) -> View:
    return View(
        id="view-1",
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition="",
        source_refs=source_refs,
        columns=columns,
        joins=joins or [],
        filters=filters or [],
        materialization="ephemeral",
    )


class TestStructuredColumnsRefMode:
    """Case (v) + variants — ref_mode=True post-render via _rewrite_sources_to_dbt_refs."""

    def test_single_dataset_source_emits_stg_prefixed_ref_macro(self):
        """Case (i): single dataset source -> {{ ref('stg_<snake>') }}."""
        view = _structured_view(
            name="Customer Summary",
            source_refs=[{"id": "ds-1", "name": "orders", "type": "dataset"}],
            columns=[
                ViewColumn(
                    name="order_id",
                    source_ref="ds-1",
                    source_column="order_id",
                    display_type=DisplayType.id,
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        assert "{{ ref('stg_orders') }}" in sql
        # Byte-faithful: the bare quoted identifier "orders" must be gone.
        assert '"orders"' not in sql

    def test_single_view_source_emits_int_prefixed_ref_macro(self):
        """Case (ii): single view source -> {{ ref('int_<snake>') }}."""
        view = _structured_view(
            name="Aggregated",
            source_refs=[{"id": "view-1", "name": "customer_summary", "type": "view"}],
            columns=[
                ViewColumn(
                    name="customer_id",
                    source_ref="view-1",
                    source_column="customer_id",
                    display_type=DisplayType.id,
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        assert "{{ ref('int_customer_summary') }}" in sql
        assert '"customer_summary"' not in sql

    def test_mixed_dataset_and_view_sources_emit_distinct_prefixes(self):
        """Case (iii): multiple mixed dataset+view sources, joined."""
        view = _structured_view(
            name="Mixed",
            source_refs=[
                {"id": "ds-1", "name": "orders", "type": "dataset"},
                {"id": "view-2", "name": "customer_profiles", "type": "view"},
            ],
            columns=[
                ViewColumn(
                    name="order_id",
                    source_ref="ds-1",
                    source_column="order_id",
                    display_type=DisplayType.id,
                ),
                ViewColumn(
                    name="full_name",
                    source_ref="view-2",
                    source_column="full_name",
                    display_type=DisplayType.text,
                ),
            ],
            joins=[
                ViewJoin(
                    left_ref="ds-1",
                    left_column="customer_id",
                    right_ref="view-2",
                    right_column="customer_id",
                    join_type="INNER",
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        # Both macros present with distinct prefixes; no bare quoted source idents remain.
        assert "{{ ref('stg_orders') }}" in sql
        assert "{{ ref('int_customer_profiles') }}" in sql
        assert '"orders"' not in sql
        assert '"customer_profiles"' not in sql
        # Order: FROM <stg> first, then INNER JOIN <int>.
        assert sql.index("{{ ref('stg_orders') }}") < sql.index("{{ ref('int_customer_profiles') }}")

    def test_source_name_with_spaces_is_snake_cased(self):
        """Case (iv): names with spaces -> lowercase + underscores per _rewrite_sources_to_dbt_refs."""
        view = _structured_view(
            name="Spaced",
            source_refs=[{"id": "ds-1", "name": "Customer Orders Table", "type": "dataset"}],
            columns=[
                ViewColumn(
                    name="amount",
                    source_ref="ds-1",
                    source_column="amount",
                    display_type=DisplayType.decimal,
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        assert "{{ ref('stg_customer_orders_table') }}" in sql
        # Original spaced name must NOT survive in the rendered SQL.
        assert '"Customer Orders Table"' not in sql
        assert "Customer Orders Table" not in sql

    def test_view_source_name_with_spaces_uses_int_prefix(self):
        """Case (iv) — view variant: snake-case + int_ prefix together."""
        view = _structured_view(
            name="SpacedView",
            source_refs=[{"id": "view-1", "name": "Customer Profile Summary", "type": "view"}],
            columns=[
                ViewColumn(
                    name="cid",
                    source_ref="view-1",
                    source_column="customer_id",
                    display_type=DisplayType.id,
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        assert "{{ ref('int_customer_profile_summary') }}" in sql
        assert "Customer Profile Summary" not in sql

    def test_structured_columns_with_column_and_filter_renders_macro_in_from_clause(self):
        """Case (v): ref_mode=True with at least one column + one filter.

        Pins both the macro position (after FROM) and the absence of the
        bare identifier — byte-faithful capture of the full ref-mode contract.
        """
        view = _structured_view(
            name="customer_orders",
            source_refs=[{"id": "ds-1", "name": "customer_orders", "type": "dataset"}],
            columns=[
                ViewColumn(
                    name="total",
                    source_ref="ds-1",
                    source_column="total_amount",
                    display_type=DisplayType.decimal,
                    alias="total",
                ),
            ],
            filters=[
                ViewFilter(
                    source_ref="ds-1",
                    column="status",
                    operator="=",
                    value="active",
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        # Macro must appear exactly once (single source).
        assert sql.count("{{ ref('stg_customer_orders') }}") == 1
        # Macro must appear AFTER 'FROM '.
        assert "FROM {{ ref('stg_customer_orders') }}" in sql
        # Filter literal flows through ibis (closure mechanism per DWD-4);
        # presence asserted byte-faithfully.
        assert "'active'" in sql
        # Bare quoted ident must be gone.
        assert '"customer_orders"' not in sql

    @pytest.mark.parametrize(
        "ref_type,source_name,expected_macro",
        [
            ("dataset", "orders", "{{ ref('stg_orders') }}"),
            ("dataset", "Order Items", "{{ ref('stg_order_items') }}"),
            ("dataset", "MIXED Case Name", "{{ ref('stg_mixed_case_name') }}"),
            ("view", "summary", "{{ ref('int_summary') }}"),
            ("view", "Daily Summary", "{{ ref('int_daily_summary') }}"),
            ("view", "Monthly KPI", "{{ ref('int_monthly_kpi') }}"),
        ],
    )
    def test_ref_macro_emission_table(self, ref_type, source_name, expected_macro):
        """Parametrized matrix pinning prefix+snake-case per source type/name."""
        view = _structured_view(
            name="probe",
            source_refs=[{"id": "src-1", "name": source_name, "type": ref_type}],
            columns=[
                ViewColumn(
                    name="c",
                    source_ref="src-1",
                    source_column="c",
                    display_type=DisplayType.text,
                ),
            ],
        )

        sql = ViewIbisCompiler().generate_executable(view, ref_mode=True)

        assert expected_macro in sql


# ---------------------------------------------------------------------------
# Section B — legacy view.sql_definition text path
# generate_intermediate_sql() else-branch runs sql.replace(ref_id, macro) over
# the raw view.sql_definition. The macro uses ref_name_map[ref_id] verbatim
# (NOT the source name) — the snake-case + prefix rule lives in the CALLER
# that builds ref_name_map, not in intermediate.py itself.
# ---------------------------------------------------------------------------


def _legacy_view(
    *,
    sql_definition: str,
    source_refs: list[dict[str, str]],
    materialization: str = "ephemeral",
) -> View:
    return View(
        id="view-1",
        project_id="proj-1",
        org_id="org-1",
        name="Combined",
        sql_definition=sql_definition,
        source_refs=source_refs,
        columns=[],  # forces else-branch
        materialization=materialization,
    )


class TestLegacyTextPathRefSubstitution:
    """Case (vi) — legacy view.sql_definition path with sql.replace(...)."""

    def test_single_dataset_ref_substituted(self):
        view = _legacy_view(
            sql_definition="SELECT * FROM ds-1 WHERE status = 'active'",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )

        result = generate_intermediate_sql("enriched", view, {"ds-1": "stg_orders"})

        # Byte-faithful: macro substring present; raw ref-id token gone.
        assert "{{ ref('stg_orders') }}" in result
        assert "ds-1" not in result
        # The literal SQL fragments around the ref are preserved verbatim.
        assert "SELECT * FROM {{ ref('stg_orders') }} WHERE status = 'active'" in result

    def test_single_view_ref_substituted(self):
        view = _legacy_view(
            sql_definition="SELECT * FROM view-1",
            source_refs=[{"id": "view-1", "type": "view"}],
        )

        result = generate_intermediate_sql("c", view, {"view-1": "int_base"})

        assert "{{ ref('int_base') }}" in result
        assert "view-1" not in result
        assert "SELECT * FROM {{ ref('int_base') }}" in result

    def test_multiple_ref_ids_in_one_sql_string_all_substituted(self):
        """Case (vi) core: multiple ref ids in one SQL string.

        Asserts byte-faithful substitution of every occurrence, including
        repeated occurrences of the same ref id (sql.replace replaces ALL
        non-overlapping occurrences).
        """
        sql_def = (
            "SELECT a.*, b.total FROM ds-1 a JOIN view-1 b ON a.id = b.id "
            "WHERE ds-1.status = 'open' AND view-1.kind = 'x'"
        )
        view = _legacy_view(
            sql_definition=sql_def,
            source_refs=[
                {"id": "ds-1", "type": "dataset"},
                {"id": "view-1", "type": "view"},
            ],
        )

        result = generate_intermediate_sql(
            "combined",
            view,
            {"ds-1": "stg_orders", "view-1": "int_summary"},
        )

        # Each ref id appears twice in the source SQL; both macros must too.
        assert result.count("{{ ref('stg_orders') }}") == 2
        assert result.count("{{ ref('int_summary') }}") == 2
        # No raw ref ids remain.
        assert "ds-1" not in result
        assert "view-1" not in result

    def test_unresolved_ref_id_left_untouched(self):
        """If a ref id is absent from ref_name_map, sql.replace is not invoked for it."""
        view = _legacy_view(
            sql_definition="SELECT * FROM unknown-id",
            source_refs=[{"id": "unknown-id", "type": "dataset"}],
        )

        result = generate_intermediate_sql("t", view, {})

        # Byte-faithful: raw id is preserved verbatim, no macro injected.
        assert "SELECT * FROM unknown-id" in result
        assert "{{ ref(" not in result.split("\n\n", 1)[1]

    def test_config_block_precedes_substituted_sql(self):
        """Config materialized macro is the first line; SQL follows after blank line."""
        view = _legacy_view(
            sql_definition="SELECT col FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="table",
        )

        result = generate_intermediate_sql("v", view, {"ds-1": "stg_source"})

        lines = result.split("\n")
        # Byte-faithful structural shape: exact first line, exact blank second line,
        # and the substituted SQL on line three.
        assert lines[0] == "{{ config(materialized='table') }}"
        assert lines[1] == ""
        assert lines[2] == "SELECT col FROM {{ ref('stg_source') }}"

    @pytest.mark.parametrize(
        "model_name,expected_macro",
        [
            ("stg_orders", "{{ ref('stg_orders') }}"),
            ("int_summary", "{{ ref('int_summary') }}"),
            ("stg_order_items", "{{ ref('stg_order_items') }}"),
            ("int_customer_profile_summary", "{{ ref('int_customer_profile_summary') }}"),
        ],
    )
    def test_legacy_text_path_uses_ref_name_map_verbatim(self, model_name, expected_macro):
        """The legacy text path emits whatever string ref_name_map maps to —
        no snake-casing happens inside intermediate.py; the mapping is treated
        as opaque. This pins that contract so the MR-2 plugin must preserve it.
        """
        view = _legacy_view(
            sql_definition="SELECT * FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )

        result = generate_intermediate_sql("t", view, {"ds-1": model_name})

        assert expected_macro in result
