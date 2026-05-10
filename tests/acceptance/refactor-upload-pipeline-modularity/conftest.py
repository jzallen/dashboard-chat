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
- ``db_engine`` — session-scoped aiosqlite engine + schema. Mirrors
  ``backend/tests/conftest.py``.
- ``db_session`` — per-test ``AsyncSession`` with nested-savepoint
  rollback isolation, mirroring ``backend/tests/conftest.py``.
- ``repository_container`` — composition root: a ``RestrictedSession``
  wrapping the per-test ``AsyncSession``, with the production
  ``RepositoryContainer`` wired around it. The new
  ``UploadPluginDispatcher`` is observable only through the use case it
  serves (DWD-8 in DESIGN's wave-decisions.md).
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend's `app` package + tests' `tests.uuidv7_fixtures`
# importable. Acceptance suite lives at the repo root; backend is at
# `backend/`. Conftest is at `tests/acceptance/<feature>/conftest.py`,
# so parents[3] is the repo root (mirrors tests/acceptance/dbt-test-
# validation/conftest.py).
_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's
# registry so the .feature files resolve. Ruff would strip the import
# without the noqa marker.
sys.path.insert(0, str(Path(__file__).parent))
from steps.upload_pipeline_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Real-IO fixtures (DWD-1) — mirror backend/tests/conftest.py shape
# ---------------------------------------------------------------------------


_engine = None
_schema_created = False


@pytest.fixture(scope="session")
def db_engine():
    """Session-scoped aiosqlite engine with the production schema applied.

    Mirrors backend/tests/conftest.py: in-memory aiosqlite, PRAGMA
    foreign_keys=ON, deterministic uuidv7() shim via the test fixture
    helper. The engine is yielded once per session; per-test isolation
    is provided by the ``db_session`` fixture below.
    """
    global _engine
    from app.database import Base
    from app.infra.idempotency import IdempotencyKeyRecord  # noqa: F401 — register with Base.metadata
    from tests.uuidv7_fixtures import make_test_uuidv7

    if _engine is None:
        _engine = create_async_engine("sqlite+aiosqlite://", echo=False)
        _test_uuidv7 = make_test_uuidv7()

        @event.listens_for(_engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            dbapi_connection.create_function("uuidv7", 0, _test_uuidv7)

    yield _engine


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Per-test database session with automatic rollback.

    Mirrors backend/tests/conftest.py: outer transaction + nested
    SAVEPOINT that restarts on each release, so multiple commits in
    production code don't escape the test's isolation envelope. After
    the test, the outer transaction rolls back.
    """
    global _schema_created
    from app.database import Base

    if not _schema_created:
        async with db_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        _schema_created = True

    conn = await db_engine.connect()
    txn = await conn.begin()
    await conn.begin_nested()

    session = AsyncSession(bind=conn, expire_on_commit=False)

    @event.listens_for(session.sync_session, "after_transaction_end")
    def restart_savepoint(sync_session, transaction):
        if transaction.nested and not transaction._parent.nested:
            sync_session.begin_nested()

    yield session

    await session.close()
    await txn.rollback()
    await conn.close()


@pytest_asyncio.fixture
async def repository_container(db_session):
    """Bind the per-test session to the production ``RepositoryContainer``.

    The session is set on the context-var the production
    ``@with_repositories`` decorator reads. Step glue invokes
    ``create_dataset_from_upload(...)`` through the regular use case
    entrypoint with a ``repositories={"lake_repository": ...}`` override
    so the production decorator stack still mints the container — same
    shape as the existing 15 tests at
    backend/tests/use_cases/dataset/test_create_dataset_from_upload.py.
    """
    from app.auth.context import clear_auth_user, set_auth_user
    from app.auth.types import AuthUser
    from app.repositories import RepositoryContainer, RestrictedSession, set_session
    from tests.uuidv7_fixtures import ORG_1, USER_1

    set_session(db_session)
    set_auth_user(AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User"))

    container = RepositoryContainer(RestrictedSession(db_session))
    container._session = db_session  # carried for step glue that re-reads after commit
    try:
        yield container
    finally:
        clear_auth_user()
