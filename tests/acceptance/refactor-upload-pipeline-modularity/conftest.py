# <!-- DES-ENFORCEMENT : exempt -->
"""Acceptance-test configuration for refactor-upload-pipeline-modularity (ADR-022).

DWD-1 in distill/wave-decisions.md: real I/O via SQLite + boto3.Stubber.
The refactor's "real adapter" surface is identical to what
backend/tests/use_cases/dataset/test_create_dataset_from_upload.py uses
for the existing 15 tests — that is the substrate the production code
runs against, and the substrate the Iron Rule binds the refactor to
preserve. No compose stack is required (DWD-9 in DESIGN's
wave-decisions.md: surface fence, no new external integration).

Fixtures here:
- ``repository_container`` — session-scoped composition root: an
  ``AsyncSession`` against an in-memory SQLite engine wired into the
  production ``RepositoryContainer``. Step glue invokes
  ``create_dataset_from_upload`` through this container exactly the way
  ``with_repositories`` does in production. The new
  ``UploadPluginDispatcher`` is observable only through the use case it
  serves (DWD-8 in DESIGN's wave-decisions.md: use-case-internal
  coordinator, never registered in the container).
- ``db_engine`` — session-scoped aiosqlite engine + schema. Mirrors
  ``backend/tests/conftest.py``.
- Star-import of step bindings from ``steps/`` so pytest-bdd registers
  every ``@given``/``@when``/``@then``.

DELIVER fills in the fixture wiring in Phase 00 of the roadmap; until
then both fixtures are pytest.skip scaffolds and every scenario errors
with a clean "DELIVER implements" signal.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend's `app` package + tests' `tests.uuidv7_fixtures`
# importable. Acceptance suite lives at the repo root; backend is at
# `backend/`. Mirrors the sys.path discipline in
# tests/acceptance/refactor-metadata-repository-split/conftest.py and
# tests/acceptance/extract-dataset-query-port/conftest.py.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import pytest  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's
# registry so the .feature files resolve. Ruff would strip the import
# without the noqa marker.
sys.path.insert(0, str(Path(__file__).parent))
from steps.upload_pipeline_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Real-IO fixtures (DWD-1)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def db_engine():
    """Session-scoped aiosqlite engine + Base.metadata.create_all.

    DISTILL scaffold — DELIVER fleshes out per backend/tests/conftest.py
    semantics (in-memory aiosqlite, uuidv7 stub, FK pragma, async
    engine). For now this fixture is a pytest.skip placeholder so the
    .feature/steps modules collect cleanly.
    """
    pytest.skip(
        "DISTILL scaffold — DELIVER wires the SQLite engine fixture "
        "in Phase 00 per backend/tests/conftest.py conventions "
        "(in-memory aiosqlite, uuidv7 stub, FK pragma)."
    )


@pytest.fixture
def repository_container(db_engine):
    """The driving-port wiring — a `RepositoryContainer` bound to a real session.

    DISTILL scaffold — DELIVER constructs:
        session = AsyncSession(bind=db_engine, ...)
        restricted = RestrictedSession(session)
        return RepositoryContainer(restricted)

    Step glue invokes ``create_dataset_from_upload(...)`` with a
    repositories override:
        repositories={
            "lake_repository": partial(MinIOLakeRepository,
                                       s3_client=capture.s3_stubber.client),
            ... (other overrides as the existing 15 tests use them) ...,
        }
    so the production ``with_repositories`` decorator wires the
    container's metadata + outbox into the call alongside the
    s3-stubbed lake. This matches the existing test conventions at
    backend/tests/use_cases/dataset/test_create_dataset_from_upload.py
    line by line (Iron Rule fence: those 15 tests stay byte-for-byte
    green, this acceptance suite is parallel to them).
    """
    pytest.skip(
        "DISTILL scaffold — DELIVER wires the RepositoryContainer "
        "fixture in Phase 00 once the UploadPluginDispatcher and the "
        "MultiProcessingResult canonicalization land."
    )
