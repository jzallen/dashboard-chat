# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for the walking-skeleton characterization feature.

The walking-skeleton steps render through the real compilers + the production
characterization harness (a Mandate-7 RED scaffold). This module binds the
.feature file to the discovered step registry; no test functions are authored
directly.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("render-sql-characterization-snapshot.feature")
