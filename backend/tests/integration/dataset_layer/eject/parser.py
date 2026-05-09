"""Run-results parser — translates dbtRunnerResult into EjectTestReport.

Consumes the `DbtRunResult` dataclass returned by step 00-03's
`DbtRunner.run_build_and_test`. Reads `dbtRunnerResult.result` (a list of
`RunResult` records) directly from memory on the happy path; falls back
to parsing `<project_dir>/target/run_results.json` only when
`.result is None` (defensive — see ADR-018 §References, where
`dbtRunnerResult.result` is documented as "not fully contracted").

Pure utility, no I/O on the happy path. No top-level dbt import — the
parser duck-types against the dbt 1.8 `RunResult` attribute surface
(`.node.name`, `.status`, `.failures`, `.message`, `.execution_time`).
This makes the module importable without dbt installed and pins the
contract: when dbt 1.9 ships shape changes, the unit tests break loudly,
which is the intended upgrade-time signal.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# A model build is "ok" when status == "success"; a test execution is
# "ok" when status == "pass". Anything else (fail, error, skipped, runtime
# error, ...) collapses to a failure for the binary EjectTestReport.status.
_BUILD_OK = frozenset({"success"})
_TEST_OK = frozenset({"pass"})


@dataclass(frozen=True)
class RunResult:
    """One model-build or test-execution result.

    Attributes mirror the subset of `dbt.cli.main.RunResult` that the
    parser reads (see ADR-018 §4 probe_run_results_shape).
    """

    name: str
    status: str
    failures: int = 0
    message: str = ""
    execution_time_ms: float = 0.0


@dataclass
class EjectTestReport:
    """Observable outcome of one eject-and-test invocation.

    Status is the single binary outcome the customer cares about; the
    other fields are diagnostic context for failing-test triage.
    """

    status: str  # "pass" | "fail"
    models_built: list[str] = field(default_factory=list)
    tests_run: list[str] = field(default_factory=list)
    failures: list[RunResult] = field(default_factory=list)
    seeded_profile_bucket: str = ""
    seeded_profile_endpoint: str = ""


class RunResultsParser:
    """Parses a `DbtRunResult` (step 00-03) into an `EjectTestReport`."""

    def __init__(self, **kwargs: Any) -> None:
        # kwargs reserved for future tuning (e.g., status-set overrides).
        self._kwargs = kwargs

    def parse(self, runner_result: Any, project_dir: str | None = None) -> EjectTestReport:
        """Translate `runner_result` into an `EjectTestReport`.

        `runner_result` is the `DbtRunResult` from
        `DbtRunner.run_build_and_test` — exposes `.build_result` and
        `.test_result`, each a `dbtRunnerResult` carrying a `.result`
        list of `RunResult` records.

        When `test_result.result is None`, falls back to reading
        `<project_dir>/target/run_results.json`. `project_dir` is
        required for the fallback path; the happy path ignores it.
        """
        models_built, build_failures = self._read_build_results(runner_result)

        test_records = self._read_test_records(runner_result, project_dir)
        tests_run, test_failures = self._classify_tests(test_records)

        all_failures = build_failures + test_failures
        status = "pass" if not all_failures else "fail"

        return EjectTestReport(
            status=status,
            models_built=models_built,
            tests_run=tests_run,
            failures=all_failures,
        )

    # ------------------------------------------------------------------
    # Build phase — list of RunResult, status "success" is the only ok.
    # ------------------------------------------------------------------

    def _read_build_results(self, runner_result: Any) -> tuple[list[str], list[RunResult]]:
        build = getattr(runner_result, "build_result", None)
        records = getattr(build, "result", None) if build is not None else None
        if not records:
            return [], []

        models_built: list[str] = []
        failures: list[RunResult] = []
        for record in records:
            converted = _to_run_result(record)
            models_built.append(converted.name)
            if converted.status not in _BUILD_OK:
                failures.append(converted)
        return models_built, failures

    # ------------------------------------------------------------------
    # Test phase — `.result` first, fallback to target/run_results.json.
    # ------------------------------------------------------------------

    def _read_test_records(self, runner_result: Any, project_dir: str | None) -> list[RunResult]:
        test = getattr(runner_result, "test_result", None)
        records = getattr(test, "result", None) if test is not None else None
        if records is not None:
            return [_to_run_result(r) for r in records]
        return self._load_fallback_records(project_dir)

    @staticmethod
    def _load_fallback_records(project_dir: str | None) -> list[RunResult]:
        if project_dir is None:
            return []
        path = Path(project_dir) / "target" / "run_results.json"
        if not path.exists():
            return []
        payload = json.loads(path.read_text())
        return [_from_json_record(r) for r in payload.get("results", [])]

    @staticmethod
    def _classify_tests(
        records: list[RunResult],
    ) -> tuple[list[str], list[RunResult]]:
        tests_run: list[str] = []
        failures: list[RunResult] = []
        for record in records:
            tests_run.append(record.name)
            if record.status not in _TEST_OK:
                failures.append(record)
        return tests_run, failures


# ---------------------------------------------------------------------------
# Adapters: dbt RunResult / run_results.json record -> our RunResult value.
# ---------------------------------------------------------------------------


def _to_run_result(record: Any) -> RunResult:
    """Duck-type a dbt 1.8 `RunResult` into our local value object."""
    node = getattr(record, "node", None)
    name = getattr(node, "name", None) or getattr(record, "unique_id", "") or ""
    return RunResult(
        name=name,
        status=str(getattr(record, "status", "")),
        failures=int(getattr(record, "failures", 0) or 0),
        message=str(getattr(record, "message", "") or ""),
        execution_time_ms=float(getattr(record, "execution_time", 0.0) or 0.0),
    )


def _from_json_record(record: dict) -> RunResult:
    """Build a RunResult from a `run_results.json` entry (dbt 1.8 schema)."""
    return RunResult(
        name=record.get("unique_id", ""),
        status=str(record.get("status", "")),
        failures=int(record.get("failures") or 0),
        message=str(record.get("message") or ""),
        execution_time_ms=float(record.get("execution_time") or 0.0),
    )
