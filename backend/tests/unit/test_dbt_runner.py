"""Unit tests for DbtRunner — drives Step 00-03 (dbt-test-validation feature).

Port: `DbtRunner.run_build_and_test(project_dir)` is the driving port. The
happy-path and structural-constraint tests call it directly against a real
`dbtRunner` from `dbt.cli.main` and a tiny embedded dbt+duckdb project staged
under `tmp_path` — that exercise is what gives us the dbt-version-drift signal
on real upgrades.

The two contract-discriminator tests (substrate exception vs. legitimate
test-failure outcome) `monkeypatch` `dbtRunner.invoke` to fabricate exact
`dbtRunnerResult` shapes, mirroring how `test_run_results_parser.py` and
`test_eject_orchestrator.py` already construct dbt result objects. The
discriminator is structural (`result.exception is not None`), so a fabricated
shape is the right tool to pin the branch deterministically.

Test budget: 4 distinct behaviors (happy path, substrate exception raises,
legitimate test-failure outcome passes through, no-subprocess constraint) x 2
= 8 tests max. Using 4.
"""

from __future__ import annotations

import ast
import textwrap
from pathlib import Path

import pytest
from dbt.cli.main import dbtRunnerResult
from dbt_common.exceptions import DbtRuntimeError

# ---------------------------------------------------------------------------
# Fixtures: minimal embedded dbt project
# ---------------------------------------------------------------------------


def _write_probe_project(root: Path, model_sql: str) -> None:
    """Stage a minimal dbt+duckdb project at `root` with the given model SQL."""
    (root / "models").mkdir(parents=True, exist_ok=True)

    (root / "dbt_project.yml").write_text(
        textwrap.dedent(
            """\
            name: 'probe'
            version: '1.0.0'
            config-version: 2
            profile: 'probe'
            model-paths: ["models"]
            """
        )
    )

    (root / "profiles.yml").write_text(
        textwrap.dedent(
            """\
            probe:
              target: dev
              outputs:
                dev:
                  type: duckdb
                  path: ":memory:"
                  threads: 1
            """
        )
    )

    (root / "models" / "hello.sql").write_text(model_sql)


@pytest.fixture
def good_probe_project(tmp_path: Path) -> Path:
    _write_probe_project(tmp_path, "select 1 as one")
    return tmp_path


# ---------------------------------------------------------------------------
# Behavior 1: happy path — sequences deps -> build -> test, no raise
# ---------------------------------------------------------------------------


def test_run_build_and_test_succeeds_on_valid_project(good_probe_project: Path) -> None:
    """Given a valid dbt project, run_build_and_test sequences deps/build/test
    via dbtRunner.invoke and returns a non-None successful result."""
    from tests.integration.dataset_layer.eject.runner import DbtRunner

    runner = DbtRunner()
    result = runner.run_build_and_test(str(good_probe_project))

    # Result is non-None — caller (RunResultsParser, step 00-04) needs it.
    assert result is not None

    # Each phase recorded as a successful dbtRunnerResult.
    assert result.deps_result.success is True, f"deps phase should succeed; exception={result.deps_result.exception!r}"
    assert result.build_result.success is True, (
        f"build phase should succeed; exception={result.build_result.exception!r}"
    )
    assert result.test_result.success is True, f"test phase should succeed; exception={result.test_result.exception!r}"


# ---------------------------------------------------------------------------
# Behavior 2: substrate exception surfacing — runner raises ONLY when
# dbtRunnerResult.exception is populated (substrate lies — probe domain).
# ---------------------------------------------------------------------------


def test_run_build_and_test_raises_when_dbt_returns_substrate_exception(
    good_probe_project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Given dbtRunner.invoke returns ``success=False`` with a populated
    ``exception`` (e.g., a DbtRuntimeError from a missing adapter, profile
    parse error, or any thrown dbt-substrate failure), run_build_and_test
    raises ``DbtPhaseError`` whose message names the failing phase and chains
    the underlying exception via ``raise from``.

    Spec change: runner raises only on substrate exceptions, not on legitimate
    test failures. The previous spec ("raises when success=False" regardless
    of exception presence) conflated substrate failures with clean test-failure
    outcomes; the parser is designed to translate the latter into
    ``EjectTestReport(status='fail', failures=[...])`` (see parser.py:85-95
    and ADR-019 §"Earned-Trust contract"). Realigning the runner contract with
    the parser's pre-existing design.
    """
    from tests.integration.dataset_layer.eject.runner import DbtPhaseError, DbtRunner

    underlying = DbtRuntimeError("simulated substrate failure: adapter unreachable")
    fabricated = dbtRunnerResult(success=False, exception=underlying, result=None)

    def _stub_invoke(self: object, args: list[str]) -> dbtRunnerResult:
        return fabricated

    # Patch the dbtRunner class the runner module imports — the runner
    # constructs a fresh dbtRunner per phase, so this covers all phases.
    from dbt.cli.main import dbtRunner

    monkeypatch.setattr(dbtRunner, "invoke", _stub_invoke)

    runner = DbtRunner()

    with pytest.raises(DbtPhaseError) as excinfo:
        runner.run_build_and_test(str(good_probe_project))

    # The phase name lands in the message (callers route on it) and the
    # underlying exception is chained — both are part of the contract.
    msg = str(excinfo.value).lower()
    assert "deps" in msg or "build" in msg or "test" in msg, (
        f"DbtPhaseError must name the failing phase; got: {excinfo.value!r}"
    )
    assert excinfo.value.__cause__ is underlying, (
        f"DbtPhaseError must chain the underlying substrate exception via "
        f"`raise from`; got __cause__={excinfo.value.__cause__!r}"
    )


# ---------------------------------------------------------------------------
# Behavior 3: legitimate test-failure outcomes pass through to the caller
# WITHOUT raising. The parser classifies them via EjectTestReport.status.
# ---------------------------------------------------------------------------


def test_invoke_returns_through_when_success_false_but_exception_is_none(
    good_probe_project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Given dbtRunner.invoke returns ``dbtRunnerResult(success=False,
    exception=None, result=[<RunResult with status='fail'>])`` — i.e., dbt
    cleanly recorded a test-failure outcome — run_build_and_test must return
    the result through to the caller, NOT raise ``DbtPhaseError``.

    This is the runner-vs-parser contract per ADR-019 §"Earned-Trust contract":
    substrate failures (``exception is not None``) raise; legitimate
    test-failure outcomes pass through to ``RunResultsParser`` which translates
    them into ``EjectTestReport.failures``. parser.py:85-95 was designed for
    exactly this case; the runner currently shorts past the parser.
    """
    # Fabricate a `RunResult`-shaped record matching the parser's duck-type
    # surface (parser.py:_to_run_result reads .node.name, .status, .failures,
    # .message, .execution_time). SimpleNamespace mirrors the convention used
    # by test_run_results_parser.py.
    from types import SimpleNamespace

    from tests.integration.dataset_layer.eject.runner import DbtRunner

    failing_test_record = SimpleNamespace(
        node=SimpleNamespace(name="test.proj.unique_customers_id"),
        status="fail",
        failures=3,
        message="Got 3 results, configured to fail if != 0",
        execution_time=0.04,
    )
    fabricated = dbtRunnerResult(
        success=False,
        exception=None,
        result=[failing_test_record],
    )

    from dbt.cli.main import dbtRunner

    monkeypatch.setattr(dbtRunner, "invoke", lambda self, args: fabricated)

    runner = DbtRunner()

    # Must NOT raise — legitimate test-failure outcomes return through.
    result = runner.run_build_and_test(str(good_probe_project))

    # Each phase's result is the fabricated dbtRunnerResult — the caller
    # (parser) reads .test_result.result to classify failures.
    assert result.test_result.success is False, (
        f"test phase result must surface success=False so the parser can "
        f"classify the failures; got success={result.test_result.success!r}"
    )
    assert result.test_result.exception is None, (
        f"test phase result must surface exception=None — this is the "
        f"discriminator the runner uses to NOT raise; got "
        f"exception={result.test_result.exception!r}"
    )
    assert result.test_result.result == [failing_test_record], (
        f"test phase result must carry the RunResult records through to the "
        f"parser; got result={result.test_result.result!r}"
    )


# ---------------------------------------------------------------------------
# Behavior 3: subprocess-isolation constraint — runner.py does NOT import subprocess
# ---------------------------------------------------------------------------


def test_runner_does_not_import_subprocess() -> None:
    """ADR-018 D9 mandates the Python API path; subprocess is forbidden in the
    runner. Walk the AST for any `import subprocess` or `from subprocess ...`."""
    runner_path = Path(__file__).resolve().parents[1] / "integration" / "dataset_layer" / "eject" / "runner.py"
    tree = ast.parse(runner_path.read_text())

    offenders: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "subprocess" or alias.name.startswith("subprocess."):
                    offenders.append(f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom) and (
            node.module == "subprocess" or (node.module and node.module.startswith("subprocess."))
        ):
            offenders.append(f"from {node.module} import ...")

    assert not offenders, f"runner.py must not import subprocess (ADR-018 D9); found: {offenders}"
