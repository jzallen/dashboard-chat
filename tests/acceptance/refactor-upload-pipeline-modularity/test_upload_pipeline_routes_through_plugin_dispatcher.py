# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for upload-pipeline-routes-through-plugin-dispatcher.feature.

Scenarios are tagged @pending at the Feature level and therefore
skipped by the default `-m "not pending"` filter in pyproject.toml.
DELIVER unpends per Phase 01 in roadmap.json.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("upload-pipeline-routes-through-plugin-dispatcher.feature")
