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
) -> SimpleNamespace:
    """Mirror the dbt 1.8 `RunResult` attribute surface the parser reads."""
    return SimpleNamespace(
        node=SimpleNamespace(name=name),
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
