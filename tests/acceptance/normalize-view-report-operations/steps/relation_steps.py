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

Walking-skeleton (render-equivalence characterization) steps are wired for real.
Every phase-01..08 milestone step body is a DISTILL scaffold raising
``pytest.fail("DISTILL scaffold — DELIVER implements: <intent>")``; DELIVER
replaces each with a real implementation per roadmap.json's phase scopes.
"""
from __future__ import annotations

import asyncio
import uuid
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
# Walking skeleton — render-SQL characterization snapshot (Phase 00)
# ===========================================================================
#
# The walking skeleton seeds a representative view and report through the
# driving port, renders each to real DuckDB SQL through the real compilers, and
# pins the result as a golden snapshot. The render + snapshot pinning is owned
# by the production characterization harness at
# ``app.use_cases.relation.render_characterization`` (a Mandate-7 RED scaffold
# DELIVER implements in Phase 00) — driving the render through a production
# entry point keeps the outer loop honest (Iron Rule: the harness is code the
# refactor must keep working, not test-only glue).


@given("a fresh relation store seeded with a representative view and report")
def given_seeded_relations(capture: Capture, repository_container, db_session) -> None:
    """Seed one view and one report through the driving port.

    The Org/Project prerequisites are seeded directly on the test ``db_session``
    (background setup, not the behavior under test); the view and report are
    created through ``RepositoryContainer.metadata.create_view`` /
    ``create_report`` — the public persistence surface — so the relations are
    real rows the renderer reads back, not fabricated fixtures.
    """
    capture.container = repository_container

    org_id = "dev-org-001"
    project_id = str(uuid.uuid4())

    async def _seed() -> None:
        from app.repositories.metadata import OrganizationRecord, ProjectRecord

        db_session.add(OrganizationRecord(id=org_id, name="Org-1"))
        await db_session.flush()
        db_session.add(
            ProjectRecord(id=project_id, name="P1", org_id=org_id, created_by="acceptance-user")
        )
        await db_session.flush()

        view = await repository_container.metadata.create_view(
            project_id=project_id,
            org_id=org_id,
            name="orders_view",
            sql_definition="",
            source_refs=[{"id": "ds1", "type": "dataset", "name": "orders"}],
            columns=[
                {
                    "name": "amount",
                    "source_ref": "ds1",
                    "source_column": "amount",
                    "display_type": "decimal",
                    "grain_role": None,
                    "alias": None,
                }
            ],
            joins=[],
            filters=[],
            grain=None,
            materialization="ephemeral",
        )
        report = await repository_container.metadata.create_report(
            project_id=project_id,
            org_id=org_id,
            name="orders_report",
            report_type="fact",
            sql_definition="SELECT 1",
            source_refs=[{"id": "ds1", "type": "dataset", "name": "orders"}],
            columns_metadata=[
                {
                    "name": "region",
                    "source_column": "region",
                    "semantic_role": "dimension",
                    "semantic_type": "category",
                },
                {
                    "name": "total",
                    "source_column": "amount",
                    "semantic_role": "measure",
                    "semantic_type": "sum",
                },
            ],
            materialization="view",
        )
        capture.seeded_relations["view"] = view
        capture.seeded_relations["report"] = report

    _run(capture, _seed())


@when("the characterization harness renders every seeded relation to SQL")
def when_render_all_relations(capture: Capture) -> None:
    """Render each seeded relation through the production characterization harness.

    The harness re-hydrates each relation from its persisted rows and emits
    ``ibis.to_sql(dialect="duckdb")`` per relation — the reproducibility
    invariant (AC1) means the SQL is derivable from persisted state alone.
    """
    from app.use_cases.relation.render_characterization import render_all_relations

    capture.snapshot = _run(
        capture,
        render_all_relations(
            capture.container,
            [capture.seeded_relations["view"], capture.seeded_relations["report"]],
        ),
    )


@then("each relation pins a non-empty compiled SQL string")
def then_snapshot_pinned_per_relation(capture: Capture) -> None:
    assert capture.snapshot, "harness produced no snapshot"
    for key, sql in capture.snapshot.items():
        assert isinstance(sql, str) and sql.strip(), f"relation {key!r} rendered empty SQL"


@then("a deliberate change to a relation's rendered SQL fails the snapshot with a per-relation diff")
def then_deliberate_change_diffs(capture: Capture) -> None:
    """A mutated render must be detected against the pinned baseline.

    The harness compares a re-render against the pinned baseline and returns the
    set of drifted relation keys; a deliberate single-relation change must
    surface exactly that relation (proving the net is not a pass-through).
    """
    from app.use_cases.relation.render_characterization import diff_against_baseline

    baseline = dict(capture.snapshot)
    mutated = dict(baseline)
    first_key = next(iter(mutated))
    mutated[first_key] = mutated[first_key] + "\n-- deliberate drift"

    drifted = diff_against_baseline(baseline=baseline, current=mutated)
    assert drifted == {first_key}, f"expected exactly {first_key!r} to drift, got {drifted!r}"


@then("re-rendering with no change reproduces the identical snapshot")
def then_rerun_deterministic(capture: Capture) -> None:
    """Re-render must be byte-identical (deterministic: no timestamps, stable order)."""
    from app.use_cases.relation.render_characterization import render_all_relations

    second = _run(
        capture,
        render_all_relations(
            capture.container,
            [capture.seeded_relations["view"], capture.seeded_relations["report"]],
        ),
    )
    assert second == capture.snapshot, "re-render drifted — rendering is not deterministic"


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


@given("the store holds every existing report shape")
def given_existing_reports(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed the representative set of "
        "production-shaped reports (entity-only, dimension+measure, multi-measure) "
        "through capture.container.metadata.create_report."
    )


@then("every report hydrates through the typed projection kernel without error")
def then_all_hydrate(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: read each seeded report back and hydrate "
        "its columns through the typed ProjectionColumn/Measure kernel; assert no "
        "ValidationError is raised for any production shape."
    )


# ===========================================================================
# Phase 02 — Kernel visitor + report extension (renderer consolidation)
# ===========================================================================


@given("the renderer is consolidated behind the kernel visitor and report extension")
def given_consolidated_renderer(capture: Capture, repository_container) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: seed relations as in the walking "
        "skeleton; bind capture.container; the consolidated renderer is now the kernel "
        "visitor + report extension composing it."
    )


@then("the consolidated renderer reproduces the characterization snapshot byte-for-byte")
def then_snapshot_byte_identical(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: render every seeded relation through the "
        "consolidated path and assert equality with the Phase 00 pinned snapshot."
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


@then("the rendered SQL is byte-identical to the characterization snapshot")
def then_snapshot_byte_identical_joins(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the sequence-ordered render equals "
        "the Phase 00 pinned snapshot for that relation."
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


@given("a store where phases 03 to 07 have run read-from-rows for one release")
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


@then("the embedded component columns are gone and the rendered SQL is byte-identical")
def then_json_columns_dropped(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the JSON columns no longer exist and "
        "every relation's render equals the Phase 00 snapshot (proves nothing still reads JSON)."
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
