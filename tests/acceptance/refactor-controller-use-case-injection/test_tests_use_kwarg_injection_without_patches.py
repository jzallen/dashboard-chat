# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for tests-use-kwarg-injection-without-patches.feature.

DISTILL scaffold: scenarios are tagged @pending and skipped by default per
pyproject.toml `addopts`. DELIVER unpends per Phase 02 per roadmap.json's
scenarios_to_unskip.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("tests-use-kwarg-injection-without-patches.feature")
