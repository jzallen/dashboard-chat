# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-2-asymmetry-preservation.feature.

CRITICAL: this milestone is the asymmetry-preservation HARD GATE per
DWD-2 in DESIGN's wave-decisions.md (also the binding decision in
THIS WAVE's wave-decisions.md). The single-path absence assertion is
THE NEW characterization test required by ADR-022 and must be green
in DELIVER Phase 02 before Phase 03 begins.

Scenarios are tagged @pending at the Feature level and therefore
skipped by the default `-m "not pending"` filter. DELIVER unpends per
Phase 02 in roadmap.json.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-2-asymmetry-preservation.feature")
