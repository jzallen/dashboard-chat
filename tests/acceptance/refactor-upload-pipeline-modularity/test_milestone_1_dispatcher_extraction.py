# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-1-dispatcher-extraction.feature.

Scenarios are tagged @pending at the Feature level and therefore
skipped by the default `-m "not pending"` filter in pyproject.toml.
DELIVER unpends per Phase 01 in roadmap.json.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-1-dispatcher-extraction.feature")
