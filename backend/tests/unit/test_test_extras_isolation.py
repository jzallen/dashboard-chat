"""Guard test: backend/app/ must not import dbt or pandera.

ADR-018 establishes dbt-core, dbt-duckdb, and pandera as TEST-ONLY dependencies.
The runtime backend (backend/app/*) MUST NOT import them. This test walks every
.py file under backend/app/ and asserts no `import dbt`, `from dbt`, `import pandera`,
or `from pandera` statement exists (including aliased forms like `import dbt as foo`).

This is the test-extras isolation half of ADR-018 §Architectural Enforcement.
The companion `import-linter` rule lands in distill Phase 1.
"""

from __future__ import annotations

import ast
from pathlib import Path

FORBIDDEN_TOP_LEVEL_PACKAGES = frozenset({"dbt", "pandera"})

BACKEND_APP_DIR = Path(__file__).resolve().parents[2] / "app"


def _top_level_package(module_name: str) -> str:
    """Return the leftmost dotted segment of a module path.

    e.g. ``dbt.cli.main`` -> ``dbt``; ``pandera`` -> ``pandera``.
    """
    return module_name.split(".", 1)[0]


def _collect_forbidden_imports(source_path: Path) -> list[tuple[int, str]]:
    """Return [(lineno, statement)] for every forbidden import in the file."""
    tree = ast.parse(source_path.read_text(), filename=str(source_path))
    findings: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _top_level_package(alias.name) in FORBIDDEN_TOP_LEVEL_PACKAGES:
                    findings.append((node.lineno, f"import {alias.name}"))
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module and _top_level_package(module) in FORBIDDEN_TOP_LEVEL_PACKAGES:
                findings.append((node.lineno, f"from {module} import ..."))
    return findings


def _iter_app_python_files() -> list[Path]:
    return sorted(p for p in BACKEND_APP_DIR.rglob("*.py") if p.is_file())


def test_backend_app_does_not_import_dbt_or_pandera() -> None:
    """backend/app/ MUST NOT import dbt or pandera (ADR-018 dependency boundary)."""
    violations: list[str] = []
    for source_path in _iter_app_python_files():
        for lineno, statement in _collect_forbidden_imports(source_path):
            rel = source_path.relative_to(BACKEND_APP_DIR.parent)
            violations.append(f"{rel}:{lineno}: {statement}")

    assert not violations, (
        "backend/app/ must not import dbt or pandera (test-only deps per ADR-018). "
        "Violations:\n  " + "\n  ".join(violations)
    )


def test_ast_walker_detects_forbidden_imports_in_synthetic_source(tmp_path: Path) -> None:
    """Falsifiability check: the AST walker must catch forbidden imports.

    Without this, ``test_backend_app_does_not_import_dbt_or_pandera`` could pass
    vacuously if the walker were broken. We construct a synthetic file with each
    forbidden import shape and assert the walker flags every one.
    """
    synthetic = tmp_path / "synthetic.py"
    synthetic.write_text(
        "import dbt\n"
        "import dbt.cli.main\n"
        "import dbt as the_dbt\n"
        "from dbt.cli.main import dbtRunner\n"
        "import pandera\n"
        "from pandera import Column\n"
        "import os  # not forbidden\n"
        "from pathlib import Path  # not forbidden\n"
    )

    findings = _collect_forbidden_imports(synthetic)

    assert len(findings) == 6, f"Expected the walker to flag 6 forbidden imports, got {len(findings)}: {findings}"
    flagged_statements = {stmt for _, stmt in findings}
    assert "import dbt" in flagged_statements
    assert "import dbt.cli.main" in flagged_statements
    assert "import dbt as the_dbt" not in flagged_statements  # aliasing — only module name matters
    assert any("dbt" in s and "as" in s for s in flagged_statements) or "import dbt" in flagged_statements
    assert "from dbt.cli.main import ..." in flagged_statements
    assert "import pandera" in flagged_statements
    assert "from pandera import ..." in flagged_statements
