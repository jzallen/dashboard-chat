"""Unit tests for DbtRunner — drives Step 00-03 (dbt-test-validation feature).

Port: `DbtRunner.run_build_and_test(project_dir)` is the driving port. Tests call
it directly against a real `dbtRunner` from `dbt.cli.main` and a tiny embedded
dbt+duckdb project staged under `tmp_path`. We do NOT mock dbtRunner — that
would test our wrapper, not the real Python API; the dbt-version-drift signal
comes from exercising the real call.

Test budget: 3 distinct behaviors (happy path, failure surfacing, no-subprocess
constraint) x 2 = 6 tests max. Using 3.
"""

from __future__ import annotations

import ast
import textwrap
from pathlib import Path

import pytest

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


@pytest.fixture
def broken_probe_project(tmp_path: Path) -> Path:
    # Invalid SQL — dbt will fail during the build phase with a compile/runtime error.
    _write_probe_project(tmp_path, "select 1 as")
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
# Behavior 2: failure surfacing — broken SQL raises with phase signal
# ---------------------------------------------------------------------------


def test_run_build_and_test_raises_when_build_fails(broken_probe_project: Path) -> None:
    """Given a project with broken SQL, run_build_and_test raises an exception
    that signals which dbt phase failed (so callers can route the error)."""
    from tests.integration.dataset_layer.eject.runner import DbtRunner

    runner = DbtRunner()

    with pytest.raises(Exception) as excinfo:
        runner.run_build_and_test(str(broken_probe_project))

    # The error must surface enough signal to identify the failing phase.
    msg = str(excinfo.value).lower()
    assert "build" in msg, f"Raised error should name the failing phase ('build'); got: {excinfo.value!r}"


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
