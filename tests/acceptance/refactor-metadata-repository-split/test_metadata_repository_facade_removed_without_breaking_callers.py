# <!-- DES-ENFORCEMENT : exempt -->
"""pytest-bdd runner for metadata-repository-facade-removed-without-breaking-callers.feature.

All scenarios in this milestone are tagged @pending and skipped by the
default test filter (`-m "not pending"`). DELIVER unpends in Phase 03
once `_LegacyMetadataFacade` is deleted.
"""
from __future__ import annotations

from pytest_bdd import scenarios

scenarios("metadata-repository-facade-removed-without-breaking-callers.feature")
