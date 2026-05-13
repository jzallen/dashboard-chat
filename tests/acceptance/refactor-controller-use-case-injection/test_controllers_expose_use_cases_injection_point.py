# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for controllers-expose-use-cases-injection-point.feature.

DISTILL scaffold: scenarios are tagged @pending and skipped by default per
pyproject.toml `addopts`. DELIVER unpends per Phase 01 per roadmap.json's
scenarios_to_unskip.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("controllers-expose-use-cases-injection-point.feature")
