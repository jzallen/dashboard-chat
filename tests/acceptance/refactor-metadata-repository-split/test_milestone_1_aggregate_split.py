# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-1-aggregate-split.feature.

All scenarios in this milestone are tagged @pending and skipped by the
default test filter (`-m "not pending"`). DELIVER unpends per phase per
the roadmap.json scenarios_to_unskip lists.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-1-aggregate-split.feature")
