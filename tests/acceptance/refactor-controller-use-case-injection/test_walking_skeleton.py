# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for the walking-skeleton .feature file.

DISTILL scaffold: every step body in steps/controller_di_steps.py raises
pytest.fail("DISTILL scaffold — DELIVER implements: ..."). This module
just binds the .feature file to the discovered step registry; no test
functions are authored here directly.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("walking-skeleton.feature")
