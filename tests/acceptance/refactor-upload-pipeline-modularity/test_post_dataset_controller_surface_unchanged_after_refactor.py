# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for post-dataset-controller-surface-unchanged-after-refactor.feature.

Scenarios are tagged @pending at the Feature level and therefore
skipped by the default `-m "not pending"` filter. DELIVER unpends per
Phase 03 in roadmap.json.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("post-dataset-controller-surface-unchanged-after-refactor.feature")
