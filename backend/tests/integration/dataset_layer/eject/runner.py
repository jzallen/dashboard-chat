"""dbt runner wrapper — Python API path (ADR-019 D9).

Wraps `dbtRunner().invoke()` from `dbt.cli.main` (stable since dbt 1.5).
`run_build_and_test()` sequences three in-process invocations — `deps`,
`build`, `test` — and returns a `DbtRunResult` carrying the
`dbtRunnerResult` from each phase.

Runner-vs-parser contract (ADR-019 §"Earned-Trust contract"):

* Phase failures with ``exception is not None`` raise ``DbtPhaseError``
  (substrate lies — probe domain). The error chains the underlying
  exception via ``raise from`` and names the failing phase.
* Phase failures with ``success=False`` and ``exception is None`` (e.g.,
  dbt test recorded a fail) return through to the parser, which classifies
  them via ``EjectTestReport.status`` and ``EjectTestReport.failures``.

No subprocess. Forks/exec are forbidden in this runner; the parser
(step 00-04) consumes `dbtRunnerResult.result` directly off the returned
dataclass.

Documented constraint: `dbtRunner` is NOT safe for concurrent calls
within one Python process. Pytest serial execution is fine; pytest-xdist
worker-process isolation is fine; intra-process parallelism would need
subprocess isolation per concurrent invocation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from dbt.cli.main import dbtRunner, dbtRunnerResult


class DbtPhaseError(RuntimeError):
    """Raised when a dbt phase (deps/build/test) returns success=False."""

    def __init__(self, phase: str, result: dbtRunnerResult) -> None:
        cause = result.exception
        detail = f": {cause}" if cause is not None else ""
        super().__init__(f"dbt {phase} phase failed{detail}")
        self.phase = phase
        self.result = result


@dataclass(frozen=True)
class DbtRunResult:
    """Captures the `dbtRunnerResult` from each sequenced dbt phase.

    Returned by `DbtRunner.run_build_and_test` so downstream parsers
    (step 00-04 RunResultsParser) can inspect `test_result.result` —
    the list of `RunResult` records — without re-running dbt.
    """

    deps_result: dbtRunnerResult
    build_result: dbtRunnerResult
    test_result: dbtRunnerResult


class DbtRunner:
    """In-process dbt invoker. NOT concurrency-safe (see module docstring)."""

    def __init__(self, **kwargs: Any) -> None:
        # kwargs reserved for future tuning (e.g., custom log callbacks).
        self._kwargs = kwargs

    def run_build_and_test(self, project_dir: str) -> DbtRunResult:
        """Sequence dbt `deps` -> `build` -> `test` against `project_dir`.

        Each phase runs through a fresh `dbtRunner` instance (single
        invocation per instance — see ADR-019 Consequences for the
        concurrency constraint).

        Phase failures with ``exception is not None`` raise ``DbtPhaseError``
        (substrate lies — probe domain). Phase failures with ``success=False``
        and ``exception is None`` (e.g., dbt test recorded a fail) return
        through to the parser, which classifies them via
        ``EjectTestReport.status`` and ``EjectTestReport.failures``.
        """
        deps_result = self._invoke("deps", project_dir)
        build_result = self._invoke("build", project_dir)
        test_result = self._invoke("test", project_dir)
        return DbtRunResult(
            deps_result=deps_result,
            build_result=build_result,
            test_result=test_result,
        )

    @staticmethod
    def _invoke(phase: str, project_dir: str) -> dbtRunnerResult:
        runner = dbtRunner()
        result: dbtRunnerResult = runner.invoke(
            [
                phase,
                "--project-dir",
                project_dir,
                "--profiles-dir",
                project_dir,
            ]
        )
        # Substrate lies (substrate is broken — probe domain) raise; legitimate
        # test-failure outcomes (success=False with exception=None) return
        # through to the parser. ADR-019 §"Earned-Trust contract".
        if result.exception is not None:
            raise DbtPhaseError(phase, result) from result.exception
        return result
