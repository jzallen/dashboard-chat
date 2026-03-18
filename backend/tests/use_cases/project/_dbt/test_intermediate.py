"""Tests for intermediate model SQL generation."""

from app.models.view import View
from app.use_cases.project._dbt.intermediate import generate_intermediate_sql


def _make_view(
    view_id: str = "view-1",
    name: str = "Enriched Orders",
    sql_definition: str = "SELECT * FROM ds-1",
    source_refs: list[dict] | None = None,
    materialization: str = "ephemeral",
) -> View:
    return View(
        id=view_id,
        project_id="proj-1",
        org_id="org-1",
        name=name,
        sql_definition=sql_definition,
        source_refs=source_refs or [],
        materialization=materialization,
    )


class TestGenerateIntermediateSQL:
    def test_config_block_ephemeral(self):
        view = _make_view(materialization="ephemeral", source_refs=[], sql_definition="SELECT 1")
        result = generate_intermediate_sql("enriched_orders", view, {})

        assert result.startswith("{{ config(materialized='ephemeral') }}")

    def test_config_block_view(self):
        view = _make_view(materialization="view", source_refs=[], sql_definition="SELECT 1")
        result = generate_intermediate_sql("enriched_orders", view, {})

        assert result.startswith("{{ config(materialized='view') }}")

    def test_config_block_table(self):
        view = _make_view(materialization="table", source_refs=[], sql_definition="SELECT 1")
        result = generate_intermediate_sql("enriched_orders", view, {})

        assert result.startswith("{{ config(materialized='table') }}")

    def test_ref_resolution_for_dataset(self):
        view = _make_view(
            sql_definition="SELECT * FROM ds-1 WHERE status = 'active'",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
        )
        ref_name_map = {"ds-1": "stg_orders"}

        result = generate_intermediate_sql("enriched_orders", view, ref_name_map)

        assert "{{ ref('stg_orders') }}" in result
        assert "ds-1" not in result

    def test_ref_resolution_for_view(self):
        view = _make_view(
            sql_definition="SELECT a.*, b.total FROM view-1 a JOIN view-2 b ON a.id = b.id",
            source_refs=[
                {"id": "view-1", "type": "view"},
                {"id": "view-2", "type": "view"},
            ],
        )
        ref_name_map = {
            "view-1": "int_base_orders",
            "view-2": "int_order_totals",
        }

        result = generate_intermediate_sql("combined", view, ref_name_map)

        assert "{{ ref('int_base_orders') }}" in result
        assert "{{ ref('int_order_totals') }}" in result
        assert "view-1" not in result
        assert "view-2" not in result

    def test_mixed_dataset_and_view_refs(self):
        view = _make_view(
            sql_definition="SELECT * FROM ds-1 JOIN view-1 ON ds-1.id = view-1.id",
            source_refs=[
                {"id": "ds-1", "type": "dataset"},
                {"id": "view-1", "type": "view"},
            ],
        )
        ref_name_map = {
            "ds-1": "stg_raw_data",
            "view-1": "int_enriched",
        }

        result = generate_intermediate_sql("final", view, ref_name_map)

        assert "{{ ref('stg_raw_data') }}" in result
        assert "{{ ref('int_enriched') }}" in result

    def test_no_source_refs(self):
        view = _make_view(
            sql_definition="SELECT 1 AS one, 'hello' AS greeting",
            source_refs=[],
        )

        result = generate_intermediate_sql("static_view", view, {})

        assert "{{ config(materialized='ephemeral') }}" in result
        assert "SELECT 1 AS one, 'hello' AS greeting" in result

    def test_unresolved_ref_left_as_is(self):
        """If a ref ID is not in the map, the raw ID remains in the SQL."""
        view = _make_view(
            sql_definition="SELECT * FROM unknown-id",
            source_refs=[{"id": "unknown-id", "type": "dataset"}],
        )

        result = generate_intermediate_sql("test", view, {})

        assert "unknown-id" in result

    def test_output_structure(self):
        view = _make_view(
            sql_definition="SELECT col FROM ds-1",
            source_refs=[{"id": "ds-1", "type": "dataset"}],
            materialization="table",
        )
        ref_name_map = {"ds-1": "stg_source"}

        result = generate_intermediate_sql("my_view", view, ref_name_map)

        lines = result.split("\n")
        assert lines[0] == "{{ config(materialized='table') }}"
        assert lines[1] == ""
        assert "{{ ref('stg_source') }}" in lines[2]
