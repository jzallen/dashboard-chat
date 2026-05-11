# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-3-architectural-enforcement.feature.

DISTILL scaffold: scenarios are tagged @pending and skipped by default per
pyproject.toml `addopts`. DELIVER unpends per Phase 03 per roadmap.json's
scenarios_to_unskip.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-3-architectural-enforcement.feature")
