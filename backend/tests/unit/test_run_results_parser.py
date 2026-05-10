"""Unit tests for RunResultsParser — drives Step 00-04 (dbt-test-validation).

Port: `RunResultsParser.parse(dbt_run_result, project_dir=None)` is the
driving port. The parser is a pure utility translating the
`dbtRunnerResult` records returned by step 00-03's `DbtRunner` into an
`EjectTestReport`.

We hand-build `dbtRunnerResult` and `RunResult`-shaped fakes via
`SimpleNamespace`. ADR-018 §References pins this against dbt 1.8;
mirroring the real `dbtRunnerResult` attribute surface (`.result`, plus
each `.node.name`, `.status`, `.failures`, `.message`,
`.execution_time`) is the contract pin — when dbt 1.9 lands and the
attributes shift, this test breaks loudly. That is the intended
upgrade-time signal.

Test budget: 4 distinct behaviors (pass, fail, error, fallback) x 2 = 8.
Using 4.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from tests.integration.dataset_layer.eject.parser import (
    EjectTestReport,
    RunResultsParser,
)

# ---------------------------------------------------------------------------
# Helpers — hand-built dbtRunnerResult / RunResult shaped fakes
# ---------------------------------------------------------------------------


def _fake_run_result(
    name: str,
    status: str,
    failures: int = 0,
    message: str = "",
    execution_time: float = 0.0,
    resource_type: str | None = None,
) -> SimpleNamespace:
    """Mirror the dbt 1.8 `RunResult` attribute surface the parser reads.

    `resource_type` defaults to None so existing tests preserve the
    "no resource_type → treat as model" semantic; pass "test" / "operation"
    to mirror dbt build's mixed-record output.
    """
    node_attrs: dict[str, Any] = {"name": name}
    if resource_type is not None:
        node_attrs["resource_type"] = resource_type
    return SimpleNamespace(
        node=SimpleNamespace(**node_attrs),
        status=status,
        failures=failures,
        message=message,
        execution_time=execution_time,
    )


def _fake_runner_result(results: list | None) -> SimpleNamespace:
    """Mirror the dbt 1.8 `dbtRunnerResult` surface used by the parser."""
    return SimpleNamespace(result=results, success=results is not None, exception=None)


def _fake_dbt_run_result(build_results: list | None, test_results: list | None) -> SimpleNamespace:
    """Mirror step 00-03's `DbtRunResult` dataclass shape."""
    return SimpleNamespace(
        deps_result=_fake_runner_result([]),
        build_result=_fake_runner_result(build_results),
        test_result=_fake_runner_result(test_results),
    )


# ---------------------------------------------------------------------------
# Behavior 1: happy path — all build + test results successful
# ---------------------------------------------------------------------------


def test_parse_returns_pass_when_all_models_built_and_tests_succeed() -> None:
    """Given a DbtRunResult where every build and test result is success/pass,
    parser returns EjectTestReport(status='pass') with the model and test
    names recorded and an empty failures list."""
    run_result = _fake_dbt_run_result(
        build_results=[
            _fake_run_result("model.proj.customers", "success"),
            _fake_run_result("model.proj.orders", "success"),
        ],
        test_results=[
            _fake_run_result("test.proj.unique_customers_id", "pass"),
            _fake_run_result("test.proj.not_null_orders_id", "pass"),
        ],
    )

    report = RunResultsParser().parse(run_result)

    assert isinstance(report, EjectTestReport)
    assert report.status == "pass"
    assert report.models_built == ["model.proj.customers", "model.proj.orders"]
    assert report.tests_run == [
        "test.proj.unique_customers_id",
        "test.proj.not_null_orders_id",
    ]
    assert report.failures == []


# ---------------------------------------------------------------------------
# Behavior 2: fail path — one test reports status='fail'
# ---------------------------------------------------------------------------


def test_parse_returns_fail_when_a_test_fails() -> None:
    """Given a DbtRunResult with a test status='fail', parser returns
    status='fail' and includes the failing test in `failures`."""
    failing_test = _fake_run_result(
        "test.proj.unique_customers_id",
        "fail",
        failures=3,
        message="Got 3 results, configured to fail if != 0",
    )
    run_result = _fake_dbt_run_result(
        build_results=[_fake_run_result("model.proj.customers", "success")],
        test_results=[
            _fake_run_result("test.proj.not_null_orders_id", "pass"),
            failing_test,
        ],
    )

    report = RunResultsParser().parse(run_result)

    assert report.status == "fail"
    assert len(report.failures) == 1
    assert report.failures[0].name == "test.proj.unique_customers_id"
    assert report.failures[0].status == "fail"
    assert report.failures[0].failures == 3


# ---------------------------------------------------------------------------
# Behavior 3: error path — a model build errored
# ---------------------------------------------------------------------------


def test_parse_returns_fail_when_a_model_build_errors() -> None:
    """Given a DbtRunResult with a build result status='error', parser
    returns status='fail' and includes the erroring node in `failures`."""
    erroring_model = _fake_run_result(
        "model.proj.broken",
        "error",
        message="Compilation Error: invalid SQL",
    )
    run_result = _fake_dbt_run_result(
        build_results=[
            _fake_run_result("model.proj.customers", "success"),
            erroring_model,
        ],
        test_results=[],
    )

    report = RunResultsParser().parse(run_result)

    assert report.status == "fail"
    failure_names = [f.name for f in report.failures]
    assert "model.proj.broken" in failure_names


# ---------------------------------------------------------------------------
# Behavior 4: fallback — `.result` is None, parser reads run_results.json
# ---------------------------------------------------------------------------


def test_parse_surfaces_failing_test_name_for_drift_detector_scenario() -> None:
    """Step 02-02 contract pin: the drift-detector acceptance scenario
    requires the failing dbt test's NAME to surface verbatim in
    `EjectTestReport.failures[*].name` so the customer can triage which
    assertion failed (JOB-001 O6). This pins the `_to_run_result` adapter:
    if anyone changes the parser to drop the `node.name` field (e.g. uses
    `record.unique_id` only), this test breaks loudly.
    """
    failing_test = _fake_run_result(
        name="not_null_stg_orders_order_id",
        status="fail",
        failures=2,
        message="Got 2 results, configured to fail if != 0",
        execution_time=0.04,
    )
    successful_build = _fake_run_result(name="stg_orders", status="success")
    run_result = _fake_dbt_run_result(
        build_results=[successful_build],
        test_results=[failing_test],
    )

    report = RunResultsParser().parse(run_result)

    assert report.status == "fail"
    assert report.models_built == ["stg_orders"]
    assert report.tests_run == ["not_null_stg_orders_order_id"]
    assert len(report.failures) == 1, (
        f"expected exactly one failure entry, got {report.failures!r}"
    )
    failure = report.failures[0]
    # The customer-visible triage signal: the dbt test name verbatim.
    assert failure.name == "not_null_stg_orders_order_id"
    # Diagnostic context the orchestrator forwards to CI logs:
    assert failure.status == "fail"
    assert failure.failures == 2
    assert "configured to fail" in failure.message


def test_parse_filters_test_and_hook_records_out_of_build_phase() -> None:
    """`dbt build` returns a mixed record list — models (status="success"),
    tests (status="pass"), and hooks (status="success" with resource_type
    "operation"). `models_built` must include only model-shaped records
    so passing tests inside build do not pollute the model list AND do
    not get classified as build failures (status="pass" not in _BUILD_OK).

    Symmetrically, `dbt test` invokes on-run-start/on-run-end hooks
    alongside the tests it runs; those hook records carry status="success"
    which a naive parser would treat as a test failure (status="success"
    is not in _TEST_OK={"pass"}). The drift-detector + happy-path
    acceptance scenarios both exercise `dbt build` AND `dbt test`
    end-to-end against real DuckDB; the parser must classify both phases
    correctly or every M1 happy-path eject reports status="fail" with
    spurious failure entries naming the test that actually passed and
    the hook that actually succeeded.
    """
    run_result = _fake_dbt_run_result(
        build_results=[
            _fake_run_result("hook.proj.on_run_start", "success", resource_type="operation"),
            _fake_run_result("model.proj.stg_orders", "success", resource_type="model"),
            # The same test record dbt records inside build_result when
            # build runs the project's tests inline. status="pass" is the
            # dbt convention for tests; a naive parser would treat this as
            # a build failure because "pass" ∉ _BUILD_OK.
            _fake_run_result(
                "test.proj.not_null_stg_orders_region",
                "pass",
                resource_type="test",
            ),
        ],
        test_results=[
            # `dbt test` runs the project's on-run-start hook before the
            # tests; it lands in test_result.result with status="success"
            # which a naive parser would misclassify as a test failure.
            _fake_run_result("hook.proj.on_run_start", "success", resource_type="operation"),
            _fake_run_result(
                "test.proj.not_null_stg_orders_region",
                "pass",
                resource_type="test",
            ),
        ],
    )

    report = RunResultsParser().parse(run_result)

    assert report.status == "pass", (
        f"expected status='pass' for an all-green build+test run, got {report.status!r} "
        f"with failures={report.failures!r}"
    )
    # Only the model lands in models_built — the hook and the inline test
    # belong to other phases of the report.
    assert report.models_built == ["model.proj.stg_orders"], (
        f"models_built should contain only model-shaped records, got {report.models_built!r}"
    )
    # Only the test lands in tests_run — the hook is filtered out.
    assert report.tests_run == ["test.proj.not_null_stg_orders_region"], (
        f"tests_run should contain only test records, got {report.tests_run!r}"
    )
    assert report.failures == []


def test_parse_falls_back_to_run_results_json_when_result_is_none(tmp_path: Path) -> None:
    """ADR-018 §References notes `dbtRunnerResult.result` is 'not fully
    contracted'. When the test phase's `.result` is None, parser falls
    back to reading `<project_dir>/target/run_results.json` (dbt 1.8
    schema)."""
    target_dir = tmp_path / "target"
    target_dir.mkdir()
    (target_dir / "run_results.json").write_text(
        json.dumps(
            {
                "results": [
                    {
                        "unique_id": "test.proj.unique_customers_id",
                        "status": "pass",
                        "failures": 0,
                        "message": None,
                        "execution_time": 0.05,
                    },
                    {
                        "unique_id": "test.proj.not_null_orders_id",
                        "status": "fail",
                        "failures": 7,
                        "message": "Got 7 results",
                        "execution_time": 0.04,
                    },
                ]
            }
        )
    )

    run_result = _fake_dbt_run_result(
        build_results=[_fake_run_result("model.proj.customers", "success")],
        test_results=None,  # forces fallback
    )

    report = RunResultsParser().parse(run_result, project_dir=str(tmp_path))

    assert report.status == "fail"
    failure_names = [f.name for f in report.failures]
    assert "test.proj.not_null_orders_id" in failure_names
    assert "test.proj.unique_customers_id" in report.tests_run
