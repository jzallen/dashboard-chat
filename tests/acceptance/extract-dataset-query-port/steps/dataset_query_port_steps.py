"""Step glue for extract-dataset-query-port acceptance suite (ADR-021).

Strategy C (real local I/O) — mirrors dbt-test-validation/steps. The
walking-skeleton scenario invokes the new ``QueryEnginePort`` via the
``RepositoryContainer.query_engine`` slot (DWD-3) against the running
query-engine pool (real asyncpg + real pg_duckdb). Milestone scenarios
use a recording stand-in connection that satisfies the same protocol
surface as ``backend/tests/models/test_dataset.py``'s ``_FakeConnection``
ladder (relocated by DELIVER per DWD-4), exercising the adapter's
macro-and-COPY contract without leaving the process.

Driving-port discipline (skill Mandate 1 / F-005 analog):
    @when steps invoke ``QueryEnginePort.execute_dataset_preview`` on the
    container's ``query_engine`` slot or on a port-typed variable. They do
    NOT import ``PgDuckDBQueryEngineAdapter`` directly — the composition
    root (``RepositoryContainer.query_engine``) is the only construction
    site (DWD-3, ADR-021 §"Earned-Trust contract": wire then probe then use).

Today this file is a DISTILL scaffold. Every step body raises
``pytest.fail("DISTILL scaffold — DELIVER implements: ...")`` with a clear
intent. The walking-skeleton scenario is enabled by default; milestone
scenarios are tagged ``@pending`` and unpended one at a time per
roadmap.json's ``scenarios_to_unskip`` lists (skill Mandate 5: one
scenario at a time).
"""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from pytest_bdd import given, parsers, then, when

# RED-scaffold marker — DISTILL hands this file to DELIVER as RED.
# DELIVER replaces every ``pytest.fail("DISTILL scaffold ...")`` body with
# the real implementation, scenario-by-scenario, and removes this marker
# only after the last scenario is GREEN. Mandate 7 / nw-distill convention.
__SCAFFOLD__ = True

# Make the backend importable so the walking-skeleton step glue can resolve
# `app.query_engine` and `app.repositories` once DELIVER lands the port.
# Acceptance suite lives at the repo root; backend is at `backend/`.
# Ruff would strip the imports without the # noqa markers — skill F-003.
_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))


# ---------------------------------------------------------------------------
# Capture object — observable state collected per scenario
# ---------------------------------------------------------------------------


@dataclass
class Capture:
    """Per-scenario observable state.

    Mirrors the dbt-test-validation suite's ``Capture`` pattern: the
    @given/@when steps populate fields here, the @then steps read them.
    Step fixtures pass this object explicitly so steps stay stateless
    and scenario isolation is enforced.
    """

    dataset: Any = None
    storage_bucket: str | None = None
    preview_rows_through_port: list[dict[str, Any]] | None = None
    preview_rows_through_legacy: list[dict[str, Any]] | None = None
    recording_connection: Any = None
    deprecation_message: str | None = None
    dataset_detail: Any = None
    captured_warnings: list[Any] = field(default_factory=list)
    error: BaseException | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@pytest.fixture
def capture() -> Capture:
    return Capture()


# ---------------------------------------------------------------------------
# Background steps (shared across walking-skeleton + milestones)
# ---------------------------------------------------------------------------


@given("the query engine pool is reachable on the running compose stack")
def given_query_engine_reachable(query_engine_pool: Any) -> None:
    """Background marker — the session-scoped fixture has already probed.

    The fixture itself raises pytest.skip on substrate breakage, so by the
    time this step runs the pool is reachable. The step body is a noop
    that exists for Gherkin readability.
    """
    assert query_engine_pool is not None


@given("the query engine port has been wired into the repository container")
def given_query_engine_port_wired() -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: construct the "
        "RepositoryContainer with the new query_engine slot wired to a "
        "PgDuckDBQueryEngineAdapter instance per DWD-3"
    )


# ---------------------------------------------------------------------------
# Walking-skeleton @given steps — dataset construction + bucket config
# ---------------------------------------------------------------------------


@given(
    parsers.parse(
        'a dataset named "{name}" with a single text column "{column}" '
        'stored under project "{project_id}" and dataset id "{dataset_id}"'
    )
)
def given_dataset_with_one_text_column(
    capture: Capture, name: str, column: str, project_id: str, dataset_id: str
) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a Dataset(id=dataset_id, "
        "project_id=project_id, name=name, schema_config={column: 'text'}) and "
        "store on capture.dataset"
    )


@given(parsers.parse('the storage bucket is configured as "{bucket}"'))
def given_storage_bucket(capture: Capture, bucket: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch app.config.get_settings "
        "to return Settings(storage_bucket=bucket); record capture.storage_bucket"
    )


# ---------------------------------------------------------------------------
# Walking-skeleton @when — driving-port invocation
# ---------------------------------------------------------------------------


@when(parsers.parse("the dataset's preview rows are fetched through the query engine port with limit {limit:d}"))
def when_preview_rows_fetched(capture: Capture, limit: int) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "container.query_engine.execute_dataset_preview(capture.dataset, limit) "
        "and store result on capture.preview_rows_through_port. The legacy "
        "comparison row set is computed by the same code path the legacy "
        "test pinned (Iron Rule: do not change the SQL shape; the adapter "
        "must produce the byte-identical SQL the model produced)."
    )


@when("the dataset's preview rows are fetched through the query engine port")
def when_preview_rows_fetched_default_limit(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "container.query_engine.execute_dataset_preview(capture.dataset) with "
        "the default limit and store result on capture.preview_rows_through_port"
    )


# ---------------------------------------------------------------------------
# Walking-skeleton @then — observable outcomes (Dim 7: return values only)
# ---------------------------------------------------------------------------


@then("the same preview rows the legacy path produced are returned")
def then_preview_rows_match_legacy(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.preview_rows_through_port == capture.preview_rows_through_legacy "
        "(byte-identical row content; the COPY-from-stdout path produces "
        "deterministic output)"
    )


@then("the query engine received exactly one COPY-from-stdout call")
def then_one_copy_call(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "len(capture.recording_connection.copy_from_query_calls) == 1 (for "
        "milestone scenarios) OR validate via observable preview-row content "
        "for the WS real-pool path"
    )


@then(parsers.parse('the outer SQL was "{outer_sql}"'))
def then_outer_sql_pinned(capture: Capture, outer_sql: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.copy_from_query_calls[0][0] == outer_sql "
        "(this is the constant pinned at test_dataset.py:965 — DWD-4 binds "
        "DELIVER to preserve it byte-for-byte)"
    )


@then(parsers.parse('the inner SQL was "{inner_sql}"'))
def then_inner_sql_pinned(capture: Capture, inner_sql: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.copy_from_query_calls[0][1] == inner_sql "
        "(this is the constant pinned at test_dataset.py:966-970 — DWD-4 "
        "binds DELIVER to preserve it byte-for-byte)"
    )


# ---------------------------------------------------------------------------
# Milestone-1 — port-extraction correctness (COPY route, macros, pool)
# ---------------------------------------------------------------------------


@given("a dataset whose transforms request a snake-case clean operation")
def given_dataset_with_snake_case_clean(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a Dataset with a clean "
        "transform whose expression_config = {'operation': 'case', 'mode': 'snake'} "
        "and store on capture.dataset"
    )


@given("a recording connection that captures every operation it receives")
def given_recording_connection(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: instantiate the relocated "
        "_FakePgDuckDBConnection (per DWD-4) with empty fetch_rows; store "
        "on capture.recording_connection; install via fake_pool_factory or "
        "the new equivalent so the adapter acquires this connection from "
        "the pool"
    )


@given("a dataset with no schema columns configured")
def given_empty_schema_dataset(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a Dataset(id='ds-1', "
        "project_id='p', name='N') with no schema_config; store on capture.dataset"
    )


@given(parsers.parse('a dataset named "{name}" with a single text column "{column}" under project "{project_id}" and dataset id "{dataset_id}"'))
def given_dataset_named(capture: Capture, name: str, column: str, project_id: str, dataset_id: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a Dataset(id=dataset_id, "
        "project_id=project_id, name=name, schema_config={column: 'text'}) and "
        "store on capture.dataset (matches test_dataset.py:950-955 fixture shape)"
    )


@given(parsers.parse('a dataset with a single text column "{column}" and a clean transform with mode "{mode}"'))
def given_dataset_with_clean_transform(capture: Capture, column: str, mode: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: build a Dataset with "
        "schema_config={column: 'text'} and a single clean transform whose "
        "expression_config = {'operation': 'case', 'mode': mode}; store on "
        "capture.dataset"
    )


@given("a connection whose pg_duckdb extension is not loaded")
def given_connection_without_pg_duckdb(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: install a recording connection "
        "whose execute() raises asyncpg.UndefinedFunctionError (or equivalent) "
        "when called with 'SELECT duckdb.raw_query($1)'"
    )


@when("the dataset's preview rows are fetched through the query engine port three times in a row")
def when_preview_rows_fetched_three_times(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke execute_dataset_preview "
        "three times in sequence; record each connection acquired on capture.extra"
    )


@then("the connection pool was never acquired")
def then_pool_never_acquired(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert no connection was "
        "acquired from the pool on the empty-schema short-circuit path "
        "(this is the test_query_preview_rows_when_staging_sql_errors_returns_empty_list "
        "characterization — relocated per DWD-4)"
    )


@then("the recording connection received exactly one COPY-from-stdout call")
def then_recording_connection_one_copy(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "len(capture.recording_connection.copy_from_query_calls) == 1 — "
        "byte-identical to test_dataset.py:963"
    )


@then(parsers.parse('the recorded outer SQL was "{outer_sql}"'))
def then_recorded_outer_sql(capture: Capture, outer_sql: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.copy_from_query_calls[0][0] == outer_sql "
        "— byte-identical to test_dataset.py:965"
    )


@then(parsers.parse('the recorded inner SQL was "{inner_sql}"'))
def then_recorded_inner_sql(capture: Capture, inner_sql: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.copy_from_query_calls[0][1] == inner_sql "
        "— byte-identical to test_dataset.py:966-970"
    )


@then("no macro registrations were issued on the recording connection")
def then_no_macros_recorded(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.executed_sql == [] — byte-identical to "
        "test_dataset.py:972 and :1029"
    )


@then("the recording connection received one macro registration call per registered macro")
def then_one_macro_call_per_macro(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.recording_connection.executed_sql == ['SELECT duckdb.raw_query($1)'] * len(ALL_MACROS) "
        "— byte-identical to test_dataset.py:1003"
    )


@then(parsers.parse('every macro registration call ran the SQL "{macro_call_sql}"'))
def then_every_macro_call_uses_raw_query(capture: Capture, macro_call_sql: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert every entry in "
        "capture.recording_connection.executed_sql equals macro_call_sql "
        "— supports the test_dataset.py:1003 byte-identity claim"
    )


@then("the macro bodies recorded as positional arguments equal the project's macro catalogue in order")
def then_macro_bodies_match_catalogue(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "[args[0] for args in capture.recording_connection.executed_args] == list(ALL_MACROS) "
        "— byte-identical to test_dataset.py:1004"
    )


@then("the same connection that ran the COPY-from-stdout call also received the macro registrations")
def then_same_connection_macros_and_copy(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that the connection on "
        "which copy_from_query_calls is non-empty is the same instance whose "
        "executed_sql contains the macro-registration entries (DuckDB macros "
        "are connection-scoped DDL — DWD-1 binding rationale)"
    )


@then("the macro registrations happened before the COPY-from-stdout call")
def then_macros_before_copy(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert ordering on the "
        "recording connection — every executed_sql entry for "
        "'SELECT duckdb.raw_query($1)' has index < the implicit COPY index"
    )


@then("each preview call acquires its own connection from the pool")
def then_each_call_acquires_own_connection(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert len(capture.extra['connections']) == 3 "
        "and the three connection instances are distinct"
    )


@then("each call registers the customer's macros exactly once on its own connection")
def then_each_call_registers_macros_once(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: for each connection, assert "
        "executed_sql.count('SELECT duckdb.raw_query($1)') == len(ALL_MACROS)"
    )


@then("no connection receives the same macro registration twice")
def then_no_double_registration(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: for each connection, assert "
        "executed_args entries form a set whose size == len(ALL_MACROS)"
    )


@then("the customer sees a query engine error naming pg_duckdb as the missing capability")
def then_error_names_pg_duckdb(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert capture.error is a "
        "QueryEngineError (per ADR-021 §4 Layout: exceptions.py) AND "
        "'pg_duckdb' in str(capture.error).lower()"
    )


@then("no preview rows are returned")
def then_no_preview_rows(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.preview_rows_through_port == [] (or None — depending on "
        "whether the adapter raises or returns empty for the empty-schema "
        "short-circuit case)"
    )


# ---------------------------------------------------------------------------
# Milestone-2 — caller migration: legacy method -> direct port use
# ---------------------------------------------------------------------------


@when(parsers.parse("the customer fetches preview rows through the legacy dataset method with limit {limit:d}"))
def when_legacy_method_fetches_preview(capture: Capture, limit: int) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "capture.dataset.query_preview_rows(limit=limit) (the legacy delegator), "
        "capture any DeprecationWarning into capture.captured_warnings, and "
        "store the returned rows on capture.preview_rows_through_legacy"
    )


@when(parsers.parse("the customer also fetches preview rows directly through the query engine port with limit {limit:d}"))
def when_port_directly_fetches_preview(capture: Capture, limit: int) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "container.query_engine.execute_dataset_preview(capture.dataset, limit) "
        "and store the returned rows on capture.preview_rows_through_port"
    )


@when("the customer requests a dataset detail with preview included")
def when_customer_requests_dataset_detail(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke "
        "DatasetService.fetch_dataset(dataset_id=..., include_preview=True) "
        "with the test container's wired query_engine; store the returned "
        "Dataset (with preview_rows attached) on capture.dataset_detail; "
        "capture any error on capture.error"
    )


@then("both paths return identical preview rows")
def then_both_paths_identical(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.preview_rows_through_legacy == capture.preview_rows_through_port "
        "(byte-identical content)"
    )


@then("both paths emitted the same outer and inner SQL on the recording connection")
def then_both_paths_same_sql(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert there are exactly two "
        "entries on capture.recording_connection.copy_from_query_calls and that "
        "the two entries are equal (the legacy delegator must produce the "
        "byte-identical SQL the direct port call produces — DWD-5 contract)"
    )


@then(parsers.parse('the customer is shown a deprecation notice naming "{replacement}" as the replacement'))
def then_deprecation_notice_names_replacement(capture: Capture, replacement: str) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert at least one "
        "DeprecationWarning was captured on capture.captured_warnings AND "
        "the replacement string appears in the warning message — DWD-5 "
        "binding contract"
    )


@then("the preview rows the legacy method returned still match what the new port returns")
def then_legacy_rows_still_match_port(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.preview_rows_through_legacy is not None and equals what the "
        "port produces for the same dataset+limit"
    )


@then("the dataset service obtained preview rows through the query engine port")
def then_service_used_port(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that the wired "
        "QueryEnginePort recorded exactly one execute_dataset_preview call "
        "with capture.dataset_detail.id matching the requested dataset id "
        "(observable through the spy adapter the test container injected)"
    )


@then("the dataset model was not asked to execute the preview query itself")
def then_dataset_model_not_invoked(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that the legacy "
        "delegator on Dataset.query_preview_rows was NOT invoked during the "
        "service call (verified by leaving the legacy method un-patched and "
        "asserting capture.captured_warnings contains no DeprecationWarning)"
    )


@then("no preview rows are attached to the dataset detail")
def then_no_preview_on_detail(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.dataset_detail is None OR capture.dataset_detail.preview_rows == []"
    )


# ---------------------------------------------------------------------------
# Milestone-3 — domain cleanup + import-linter contract
# ---------------------------------------------------------------------------


@given("the dataset model has completed its deprecation cycle")
def given_deprecation_cycle_complete(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that the legacy "
        "delegator has been removed in this commit (i.e. "
        "hasattr(Dataset, 'query_preview_rows') is False), and store the "
        "current Dataset class on capture.dataset for surface inspection"
    )


@given("the query engine substrate is unreachable")
def given_substrate_unreachable(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: monkeypatch "
        "asyncpg.create_pool to raise ConnectionRefusedError so the probe "
        "fails on its first acquire (ADR-021 §Earned-Trust contract probe 1)"
    )


@given("the query engine substrate accepts connections but pg_duckdb is not installed")
def given_pg_duckdb_missing(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: install a recording pool "
        "whose connections accept SELECT 1 but raise UndefinedFunctionError "
        "for SELECT duckdb.raw_query('SELECT 1') so probe step 3 fails "
        "(ADR-021 §Earned-Trust contract probe 3)"
    )


@when("the customer inspects the dataset model's public surface")
def when_inspect_dataset_surface(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: enumerate the public methods "
        "on Dataset and store as capture.extra['public_methods']"
    )


@when("the project's import boundaries are inspected")
def when_inspect_imports(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke the import-linter / "
        "pytest-archon rule runner against the configured contracts (DWD-6: "
        "app.models.* MUST NOT import asyncpg/sql_functions/get_query_engine_pool; "
        "only app.query_engine.* MAY import asyncpg; app.query_engine.* MUST NOT "
        "import ibis); store the contract result on capture.extra['import_contracts']"
    )


@when("the application starts up and the port runs its substrate probe")
def when_app_startup_runs_probe(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: invoke the FastAPI lifespan "
        "(or the wire-then-probe-then-use entry point that the composition "
        "root publishes); capture any startup-refused event on "
        "capture.extra['startup_event'] and any raised exception on capture.error"
    )


@then("the legacy preview method is no longer offered on the dataset model")
def then_legacy_method_removed(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "'query_preview_rows' not in capture.extra['public_methods']"
    )


@then("the only remaining way to fetch preview rows is through the query engine port")
def then_only_port_fetches_previews(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that the only public "
        "callable that returns preview rows is QueryEnginePort.execute_dataset_preview "
        "(checked via the import-contract result stored on capture.extra)"
    )


@then("the dataset model does not import the query engine connection pool")
def then_no_pool_import_in_model(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the import-contract "
        "stored on capture.extra['import_contracts'] reports zero violations "
        "for 'app.models.* -> app.database.get_query_engine_pool'"
    )


@then("the dataset model does not import the project's macro catalogue")
def then_no_macros_import_in_model(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the import-contract "
        "reports zero violations for 'app.models.* -> app.utils.sql_functions'"
    )


@then("the dataset model does not import the asyncpg driver")
def then_no_asyncpg_in_model(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the import-contract "
        "reports zero violations for 'app.models.* -> asyncpg'"
    )


@then("only the query engine package imports the asyncpg driver")
def then_only_query_engine_imports_asyncpg(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the import-contract "
        "reports zero violations for the rule 'only app.query_engine.* MAY "
        "import asyncpg' — DWD-6 structural enforcement layer"
    )


@then("the query engine package does not import the SQL generator library")
def then_query_engine_does_not_import_ibis(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert the import-contract "
        "reports zero violations for 'app.query_engine.* -> ibis' — DWD-7 "
        "binding (ADR-007 separation: Ibis generates, the adapter executes)"
    )


@then('startup is refused with a structured "query engine substrate refused" event')
def then_startup_refused_event(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.extra['startup_event'] is a structured 'health.startup.refused' "
        "event AND capture.error is the FastAPI startup-raised exception"
    )


@then("the customer never receives a preview from an uninitialised port")
def then_no_preview_from_uninit_port(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert that no request can "
        "reach the dataset preview endpoint after probe failure — startup "
        "is refused, so the application never enters the serve loop"
    )


@then("startup is refused with a structured event naming pg_duckdb as the missing capability")
def then_startup_refused_names_pg_duckdb(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: assert "
        "capture.extra['startup_event'] is 'health.startup.refused' AND "
        "'pg_duckdb' appears in the event's reason field — DWD-6 probe 3 "
        "fault-injection contract"
    )


@then("the customer never receives a preview from a port that cannot run macros")
def then_no_preview_without_macros(capture: Capture) -> None:
    pytest.fail(
        "DISTILL scaffold — DELIVER implements: same observable as "
        "then_no_preview_from_uninit_port — startup refusal blocks the "
        "serve loop entirely; reusing the assertion here documents that "
        "the customer's exposure is identical regardless of which probe "
        "step caught the substrate lie"
    )
