# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for milestone-2-facade-removal.feature.

All scenarios in this milestone are tagged @pending and skipped by the
default test filter (`-m "not pending"`). DELIVER unpends in Phase 03
once `_LegacyMetadataFacade` is deleted.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("milestone-2-facade-removal.feature")
