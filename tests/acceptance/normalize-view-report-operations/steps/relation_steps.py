# <!-- DES-ENFORCEMENT : exempt -->
"""Step glue for the normalize-view-report-operations acceptance suite (ADR-052).

Driving-port discipline (Mandate 1):
    @when bindings drive the ``RepositoryContainer`` (``.metadata`` for
    view/report persistence: ``create_view`` / ``get_view`` / ``create_report`` /
    ``get_report``) and the application-layer use-case functions
    (``app.use_cases.view.create_view.create_view`` /
    ``app.use_cases.report.create_report.create_report``) and the public compiler
    entry points (``ViewIbisCompiler.generate_executable`` /
    ``ReportIbisCompiler.generate_executable``). Driven adapters — ``ViewRecord``,
    ``ReportRecord``, the relation_* records, the shared component repository —
    are NEVER imported into these step bodies. The container + use-case functions
    are the entry points.

Every milestone step body is a DISTILL scaffold raising
``pytest.fail("DISTILL scaffold — DELIVER implements: <intent>")``; DELIVER
replaces each with a real implementation per the DELIVER roadmap (one step per
scenario).
"""
from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from dataclasses import dataclass, field
from typing import Any, TypeVar

import pytest
import pytest_asyncio
from pytest_bdd import given, parsers, then, when

_T = TypeVar("_T")


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class Capture:
    """Per-scenario capture of driving-port outputs.

    Holds only values returned from container-property / use-case invocations
    and the rendered SQL strings. Never holds internal adapter state.
    """

    container: Any = None
    seeded_relations: dict[str, Any] = field(default_factory=dict)
    rendered_sql: dict[str, str] = field(default_factory=dict)
    snapshot: dict[str, str] = field(default_factory=dict)
    raised_error: BaseException | None = None
    result: Any = None
    extras: dict[str, Any] = field(default_factory=dict)


@pytest_asyncio.fixture
async def capture() -> Capture:
    """Per-scenario capture; pins the session loop pytest-asyncio drives.

    pytest-bdd does not auto-await async step functions, so step bodies stay
    synchronous and drive async work via ``_run`` on the loop captured here.
    """
    cap = Capture()
    cap.extras["_loop"] = asyncio.get_running_loop()
    return cap


def _run(capture: Capture, coro: Coroutine[Any, Any, _T]) -> _T:
    """Drive a coroutine on the session loop pinned by the capture fixture."""
    loop: asyncio.AbstractEventLoop = capture.extras["_loop"]
    return loop.run_until_complete(coro)


# ===========================================================================
# Phase 01 — Report projection on the typed kernel (boundary rejection)
# ===========================================================================


@given(parsers.parse('a report definition whose column carries an unknown semantic role "{role}"'))
def given_report_payload_unknown_role(capture: Capture, repository_container, role: str) -> None:
    pytest.fail(
        f"DISTILL scaffold — DELIVER implements: build a create_report definition with a "
        f"column whose semantic_role is '{role}' (not in the typed union); store it in "
        f"capture.extras['payload']; bind capture.container = repository_container."
    )


@when("the report is submitted through the create-report use case")
def when_submit_report(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: drive "
        "app.use_cases.report.create_report.create_report(**payload, "
        "repositories=capture.container); store the returns.Result in capture.result "
        "(and/or the raised exception in capture.raised_error)."
    )


@then("the report is rejected at the boundary and nothing is persisted")
def then_rejected_nothing_persisted(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert capture.result is a Failure "
        "(structured 422-equivalent); assert no report row exists via "
        "capture.container.metadata.get_report(...) returning None / empty listing."
    )


@given("a report definition pairing an illegal semantic role and semantic type")
def given_report_payload_illegal_role_type(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a create_report definition whose "
        "column pairs a role with a type outside that role's allowed set (e.g. a "
        "dimension bound to an aggregation type); bind capture.container."
    )


@then("the report is rejected by the typed union rather than the retired free function")
def then_rejected_by_union(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert capture.result is a Failure whose "
        "error originates from the Pydantic discriminated union (ProjectionColumn/Measure) "
        "and that validate_columns_metadata is no longer importable."
    )


_PRODUCTION_REPORT_SHAPES: dict[str, list[dict]] = {
    "entity-only": [
        {"name": "order_id", "semantic_role": "entity", "semantic_type": "primary",
         "source_column": "order_id", "source_ref": "ds-orders"},
        {"name": "customer_id", "semantic_role": "entity", "semantic_type": "foreign",
         "source_column": "customer_id", "source_ref": "ds-orders"},
    ],
    "dimension+measure": [
        {"name": "region", "semantic_role": "dimension", "semantic_type": "categorical",
         "source_column": "region", "source_ref": "ds-orders"},
        {"name": "order_month", "semantic_role": "dimension", "semantic_type": "time",
         "time_granularity": "month", "source_column": "ordered_at", "source_ref": "ds-orders"},
        {"name": "revenue", "semantic_role": "measure", "semantic_type": "sum",
         "source_column": "amount", "source_ref": "ds-orders"},
    ],
    "multi-measure": [
        {"name": "region", "semantic_role": "dimension", "semantic_type": "categorical",
         "source_column": "region", "source_ref": "ds-orders"},
        {"name": "order_count", "semantic_role": "measure", "semantic_type": "count",
         "source_column": "order_id", "source_ref": "ds-orders"},
        {"name": "customers", "semantic_role": "measure", "semantic_type": "count_distinct",
         "source_column": "customer_id", "source_ref": "ds-orders"},
        {"name": "avg_order", "semantic_role": "measure", "semantic_type": "avg",
         "source_column": "amount", "source_ref": "ds-orders"},
    ],
}


@given("the store holds every existing report shape")
def given_existing_reports(capture: Capture, repository_container) -> None:
    capture.container = repository_container

    async def _seed() -> list[str]:
        project = await repository_container.metadata.create_project(
            name="normalize-projection-kernel", org_id="dev-org-001"
        )
        report_ids: list[str] = []
        for shape_name, columns in _PRODUCTION_REPORT_SHAPES.items():
            created = await repository_container.metadata.create_report(
                project_id=project["id"],
                org_id="dev-org-001",
                name=shape_name,
                sql_definition="SELECT 1",
                report_type="fact",
                columns_metadata=columns,
            )
            report_ids.append(created["id"])
        return report_ids

    capture.extras["report_ids"] = _run(capture, _seed())


@then("every report hydrates through the typed projection kernel without error")
def then_all_hydrate(capture: Capture) -> None:
    from app.models.relation import hydrate_projection_columns

    async def _read_all() -> list[list[dict]]:
        return [
            (await capture.container.metadata.get_report(report_id))["columns_metadata"]
            for report_id in capture.extras["report_ids"]
        ]

    for columns_metadata in _run(capture, _read_all()):
        hydrated = hydrate_projection_columns(columns_metadata)
        assert len(hydrated) == len(columns_metadata)


# ===========================================================================
# Phase 02 — Kernel visitor + report extension (renderer consolidation)
# ===========================================================================


@given("the renderer is consolidated behind the kernel visitor and report extension")
def given_consolidated_renderer(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a representative view and report "
        "in the test; bind capture.container; the consolidated renderer is now the kernel "
        "visitor + report extension composing it."
    )


@then(
    "the consolidated renderer produces the same SQL as the separate View and Report "
    "compilers for the same in-test relation"
)
def then_consolidated_matches_separate_compilers(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: for the same in-test relation, render it "
        "through the consolidated kernel-visitor path and through the pre-consolidation "
        "separate View and Report compilers; assert the two SQL strings are equal."
    )


@given("a component discriminator with no entry in an active render visitor")
def given_unhandled_discriminator(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: introduce a component discriminator "
        "absent from the render dispatch catalog for an active visitor."
    )


@then("the build fails on the unhandled discriminator instead of silently skipping it")
def then_build_fails(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the catalog's build-time "
        "completeness check raises (collection/build failure), not a silent skip."
    )


@given("an entity-only report with no aggregation")
def given_entity_only_report(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a report with entity columns only "
        "(no dimension, no measure) through capture.container.metadata.create_report."
    )


@then("it renders through the shared kernel path with no aggregation step")
def then_renders_via_shared_path(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the entity-only report renders as "
        "the kernel visitor's output with no group_by/aggregate step appended (not a "
        "special-cased branch)."
    )


@then("no render path reads compiled SQL back as authority")
def then_no_sql_read_as_authority(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the render is derived from "
        "persisted component state only; no path re-reads a compiled SQL string or ibis "
        "expression as an input."
    )


# ===========================================================================
# Phase 03 — relation_filters normalized (pattern-prover)
# ===========================================================================


@given("a relation with an existing set of filters")
def given_relation_with_filters(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with >=2 filters through "
        "capture.container.metadata.create_view; bind capture.container."
    )


@when("one filter is added to the relation")
def when_add_one_filter(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: add a single filter through the "
        "update-view use case / addFilter path; capture the count of relation_filters "
        "rows before and after in capture.extras."
    )


@then("exactly one filter row is inserted with no whole-array rewrite")
def then_single_row_insert(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the relation_filters row count "
        "increased by exactly one and no pre-existing filter row's identity changed "
        "(observed through the container's relation-filter read surface)."
    )


@given("a relation whose embedded filters have been backfilled")
def given_backfill(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with N embedded JSON filters, "
        "run the expand/contract backfill, bind capture.container."
    )


@then("every embedded filter maps to exactly one keyed row and the renderer reads from rows")
def then_each_json_filter_one_row(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert relation_filters row count equals "
        "the embedded filter count, each keyed by (parent_type, parent_id); assert the "
        "rendered SQL now derives from the rows."
    )


@given("a relation with two filters")
def given_two_filters(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with exactly two filters; "
        "render and store the baseline SQL in capture.rendered_sql['baseline']."
    )


@when("the two filters are reordered")
def when_reorder_filters(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: reorder the two filter rows (filters are "
        "commutative — no order column); re-render into capture.rendered_sql['reordered']."
    )


@then("the rendered SQL is unchanged")
def then_sql_unchanged(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.rendered_sql['baseline'] == capture.rendered_sql['reordered']."
    )


@when("the relation is deleted")
def when_delete_parent(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed two relations each with filter rows, "
        "delete one through capture.container.metadata.delete_view; record which parent "
        "was deleted in capture.extras."
    )


@then("only its own filter rows are removed")
def then_only_own_filter_rows_removed(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the deleted parent's filter rows "
        "are gone (repo-enforced polymorphic cascade, OQ-4)."
    )


@then("the other relation's filter rows remain intact")
def then_other_parents_filters_intact(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the surviving parent's filter rows "
        "are unchanged in count and content."
    )


@given("filter rows belonging to two tenants")
def given_filters_two_tenants(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed filter rows for two org_ids on "
        "relations in each tenant; bind capture.container."
    )


@then("loading a relation's filters returns only its own tenant's rows through an org-scoped query")
def then_filter_rows_org_scoped(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the org-scoped load returns only "
        "the target tenant's filter rows (every row carries indexed org_id)."
    )


# ===========================================================================
# Phase 04 — relation_columns normalized (shared projection)
# ===========================================================================


@given("a view and a report each projecting the same output column")
def given_view_and_report_projecting_column(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view and a report that both project "
        "output column 'X' through capture.container.metadata; bind capture.container."
    )


@when("the columns are queried across all relations")
def when_query_relation_columns(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: query relation_columns for output_name='X' "
        "through the shared component read surface; store (parent_type, parent_id) rows in "
        "capture.extras['column_hits']."
    )


@then("both the view and the report are returned in one result set")
def then_both_roles_returned(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the result set contains both a view "
        "parent and a report parent (cross-role projection query)."
    )


@when("the columns are reordered")
def when_reorder_columns(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: reorder column rows; re-render into "
        "capture.rendered_sql['reordered']."
    )


@then("the rendered SQL is unchanged after reordering columns")
def then_sql_unchanged_columns(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the baseline and reordered SQL are "
        "equal (order is not a correctness input for columns)."
    )


@when("a column's presentation position is changed")
def when_change_position(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: mutate relation_columns.position on one "
        "row; re-render into capture.rendered_sql['reposition']."
    )


@then("the rendered SQL is unchanged after changing position")
def then_sql_unchanged_position(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert baseline == reposition SQL "
        "(position is presentation-only)."
    )


@when("one column is added to the relation")
def when_add_column(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: add one column; record relation_columns "
        "row count before/after."
    )


@then("exactly one column row is inserted")
def then_single_row_insert_column(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the relation_columns row count "
        "increased by exactly one (single-row INSERT)."
    )


# ===========================================================================
# Phase 05 — relation_joins normalized (declaration-ordered sequence)
# ===========================================================================


@given("a relation with two joins in declaration order")
def given_relation_with_two_joins(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with two joins; render and "
        "store baseline SQL in capture.rendered_sql['baseline']."
    )


@when("the two joins' sequence values are swapped")
def when_swap_join_sequence(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: swap the two relation_joins.sequence "
        "values for the same parent; re-render into capture.rendered_sql['swapped']."
    )


@then("the rendered SQL differs")
def then_sql_differs(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert baseline != swapped SQL (join order "
        "is correctness-bearing — P3 positive)."
    )


@when("the joins are read back in sequence order")
def when_read_joins_in_sequence(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: render the relation reading joins in "
        "sequence order into capture.rendered_sql['in_sequence']."
    )


@then(
    "the rendered SQL is the same as rendering the equivalent embedded-array view built "
    "in the test"
)
def then_sequence_render_matches_embedded_array(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the sequence-ordered render equals "
        "the render of the equivalent embedded-array view constructed in the test."
    )


@given("a relation whose joins have been backfilled from the embedded array")
def given_join_backfill(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with an ordered joins array, "
        "run the backfill migration, bind capture.container."
    )


@then("each join's sequence follows the embedded array position rather than creation time")
def then_sequence_by_array_position(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert relation_joins.sequence equals the "
        "ROW_NUMBER over array index (array position, not created_at)."
    )


# ===========================================================================
# Phase 06 — relation_grain normalized (one row per parent, OQ-3)
# ===========================================================================


@given("a relation with a declared grain")
def given_relation_with_grain(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with a grain (time column + "
        "dimensions) through capture.container.metadata.create_view."
    )


@when("the relation's grain is queried")
def when_query_relation_grain(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: query relation_grain for the parent; store "
        "the grain keys in capture.extras['grain_keys']."
    )


@then("its grain keys are returned as rows")
def then_grain_keys_returned(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the grain keys are readable as rows "
        "(time column + dimension keys)."
    )


@when("the grain keys are reordered")
def when_reorder_grain_keys(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: reorder the grain keys (set-like); "
        "re-render into capture.rendered_sql['reordered']."
    )


@then("the rendered SQL is unchanged after reordering grain keys")
def then_sql_unchanged_grain(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert baseline == reordered SQL (grain is "
        "set-like, no order column)."
    )


@given("a relation whose grain has been backfilled")
def given_grain_backfill(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a view with a grain, run the backfill, "
        "bind capture.container."
    )


@then("exactly one grain row exists for the relation")
def then_one_row_per_parent(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert relation_grain has exactly one row "
        "for the parent (OQ-3 1:1 — ViewGrain is a single immutable VO per view)."
    )


# ===========================================================================
# Phase 07 — relation_aggregations (report-only) + report rules on rows
# ===========================================================================


@given("a report definition with a measure and no dimension")
def given_report_measure_no_dimension(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a create_report definition with >=1 "
        "measure and zero dimensions; bind capture.container."
    )


@when("the report is submitted for aggregation")
def when_submit_report_agg(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: drive create_report(**payload, "
        "repositories=capture.container); store Result/exception in capture."
    )


@then("it is rejected as requiring a dimension, evaluated over the typed rows")
def then_requires_dimension(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the failure is ReportRequiresDimension "
        "and that the check evaluated typed ProjectionColumn/Measure rows, not raw dicts."
    )


@given("a report definition whose source is another report")
def given_report_sourcing_report(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed a base report, then build a create_report "
        "payload whose source_refs point at that report; bind capture.container."
    )


@then("it is rejected by the shared composition service as a mart-to-mart reference")
def then_invalid_report_reference(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the failure is InvalidReportReference "
        "raised by the shared composition service's first-class no-mart-to-mart method "
        "(peer to View's circular-dependency arm)."
    )


@given("a report definition with a valid measure")
def given_valid_measure(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a create_report definition with one "
        "dimension and one valid measure; bind capture.container."
    )


@when("the measure is bound to an aggregation function")
def when_bind_measure(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: submit the report; record relation_aggregations "
        "row count in capture.extras."
    )


@then("exactly one aggregation row binds the measure to its function")
def then_single_aggregation_row(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert exactly one relation_aggregations row "
        "exists binding measure -> aggregation function (report parent only)."
    )


@when("the aggregations are reordered")
def when_reorder_aggregations(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: reorder the aggregation rows (independent "
        "aggregates); re-render into capture.rendered_sql['reordered']."
    )


@then("the rendered SQL is unchanged after reordering aggregations")
def then_sql_unchanged_agg(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert baseline == reordered SQL "
        "(aggregations are independent, no order column)."
    )


# ===========================================================================
# Phase 08 — CONTRACT: drop embedded-JSON columns (@infrastructure)
# ===========================================================================


@given("a store where stories 03 to 07 have run read-from-rows for one release")
def given_json_columns_present(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed relations with both JSON columns and "
        "normalized rows populated (write-both state); bind capture.container."
    )


@when("the contract migration drops the embedded component columns")
def when_run_contract_migration(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: run the drop migration removing "
        "views.{columns,joins,filters,grain} and reports.columns_metadata."
    )


@then(
    "the embedded component columns are gone and the rendered SQL is unchanged from before "
    "the columns were dropped, for the same in-test fixture"
)
def then_json_columns_dropped(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the JSON columns no longer exist and "
        "every relation's render equals its render captured before the drop, for the same "
        "in-test fixture (proves nothing still reads JSON)."
    )


@when("the rollback path is exercised")
def when_run_rollback(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: run the migration downgrade (re-add columns "
        "+ re-backfill from rows)."
    )


@then("the columns are re-added and re-backfilled from the normalized rows")
def then_columns_re_added_and_backfilled(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the JSON columns are re-added and "
        "their contents reconstructed from the relation_* rows."
    )
