# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-3-call-site-stability.feature.

Scenarios are tagged @pending at the Feature level and therefore
skipped by the default `-m "not pending"` filter. DELIVER unpends per
Phase 03 in roadmap.json.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-3-call-site-stability.feature")
