# <!-- DES-ENFORCEMENT : exempt -->
"""Acceptance-test configuration for refactor-metadata-repository-split (ADR-020).

DWD-1: real I/O via SQLite — the repository layer's "real adapter" is the
SQLAlchemy session bound to an in-memory SQLite engine. No compose stack
is required; no in-memory doubles are used.

Fixtures here:
- ``repository_container`` — session-scoped composition root: an
  ``AsyncSession`` against an in-memory SQLite engine wired into a
  ``RepositoryContainer``. Step glue accesses both ``.metadata`` (legacy
  facade) and the new per-aggregate properties (``.projects``, etc.) off
  this single container instance to prove parity through the same DB.
- ``db_engine`` — session-scoped SQLite engine + schema. Mirrors the
  approach in ``backend/tests/conftest.py``.
- Star-import of step bindings from ``steps/`` so pytest-bdd registers
  every ``@given``/``@when``/``@then``.

DELIVER fills in the per-aggregate fixture wiring once the new
``RepositoryContainer`` properties land (Phase 00 of the roadmap).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend's `app` package + tests' `tests.uuidv7_fixtures`
# importable. Acceptance suite lives at the repo root; backend is at
# `backend/`. Mirrors the sys.path discipline in
# tests/acceptance/dbt-test-validation/conftest.py.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import pytest  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's
# registry so the .feature files resolve. Ruff would strip the import
# without the noqa marker.
sys.path.insert(0, str(Path(__file__).parent))
from steps.refactor_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Real-IO repository fixtures (DWD-1)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def db_engine():
    """Session-scoped SQLite engine + Base.metadata.create_all.

    DISTILL scaffold — DELIVER fleshes out per backend/tests/conftest.py
    semantics (uuidv7 stub, FK pragma, async engine). For now this fixture
    is a placeholder so the .feature/steps modules collect.
    """
    pytest.skip(
        "DISTILL scaffold — DELIVER wires the SQLite engine fixture per "
        "backend/tests/conftest.py conventions (in-memory aiosqlite, "
        "uuidv7 stub, FK pragma)."
    )


@pytest.fixture
def repository_container(db_engine):
    """The driving port — a `RepositoryContainer` bound to a real session.

    DISTILL scaffold — DELIVER constructs:
        session = AsyncSession(bind=db_engine, ...)
        restricted = RestrictedSession(session)
        return RepositoryContainer(restricted)

    Once the new container properties land in Phase 00 of the roadmap,
    step glue accesses `.projects`, `.datasets`, etc. directly off this
    instance, alongside the legacy `.metadata` facade for parity proofs.
    """
    pytest.skip(
        "DISTILL scaffold — DELIVER wires the RepositoryContainer fixture "
        "in Phase 00 once `.projects` (and `_LegacyMetadataFacade`) land."
    )
