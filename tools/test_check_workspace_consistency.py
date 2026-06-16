#!/usr/bin/env python3
"""Regression tests for check_workspace_consistency's lockfile parser.

Run standalone (`python3 tools/test_check_workspace_consistency.py`) or under
pytest. No third-party deps so it works without the backend venv.

IF YOU'RE AN AGENT, READ THIS: the test is the spec. The inline-empty-mapping
case below guards a real parser regression — a dependency-free workspace that
pnpm 9 serializes as `pkg: {}`. Don't weaken it to make an edit pass.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MODULE_PATH = Path(__file__).resolve().parent / "check_workspace_consistency.py"
_spec = importlib.util.spec_from_file_location("check_workspace_consistency", _MODULE_PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_importer_parser_accepts_inline_empty_mapping(tmp_path, monkeypatch):
    """A dependency-free importer (`pkg: {}`) must be recognized, not dropped."""
    lock = tmp_path / "pnpm-lock.yaml"
    lock.write_text(
        "lockfileVersion: '9.0'\n"
        "\n"
        "importers:\n"
        "  .:\n"
        "    dependencies:\n"
        "      react:\n"
        "        specifier: ^18\n"
        "  agent:\n"
        "    dependencies:\n"
        "      hono:\n"
        "        specifier: ^4\n"
        "  shared/ui-state-wire: {}\n"
        "  ui: {}\n"
        "\n"
        "packages:\n"
        "  react@18.0.0: {}\n"
    )
    monkeypatch.setattr(_mod, "REPO_ROOT", tmp_path)
    assert _mod.read_pnpm_lock_importers() == {"agent", "shared/ui-state-wire", "ui"}


def test_importer_parser_still_reads_expanded_form(tmp_path, monkeypatch):
    """The expanded `pkg:` + nested `dependencies:` form keeps working."""
    lock = tmp_path / "pnpm-lock.yaml"
    lock.write_text(
        "importers:\n"
        "  .:\n"
        "    dependencies:\n"
        "      react:\n"
        "        specifier: ^18\n"
        "  shared/chat:\n"
        "    dependencies:\n"
        "      zod:\n"
        "        specifier: ^3\n"
        "\n"
        "packages:\n"
    )
    monkeypatch.setattr(_mod, "REPO_ROOT", tmp_path)
    assert _mod.read_pnpm_lock_importers() == {"shared/chat"}


if __name__ == "__main__":
    import tempfile

    class _Patch:
        def setattr(self, obj, name, value):
            setattr(obj, name, value)

    failures = 0
    for fn in (
        test_importer_parser_accepts_inline_empty_mapping,
        test_importer_parser_still_reads_expanded_form,
    ):
        original_root = _mod.REPO_ROOT
        with tempfile.TemporaryDirectory() as d:
            try:
                fn(Path(d), _Patch())
                print(f"PASS {fn.__name__}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {fn.__name__}: {exc}")
            finally:
                _mod.REPO_ROOT = original_root
    raise SystemExit(1 if failures else 0)
