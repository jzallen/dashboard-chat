# <!-- DES-ENFORCEMENT : exempt -->
"""Acceptance-test configuration for refactor-metadata-repository-split (ADR-020).

DWD-1: real I/O via SQLite — the repository layer's "real adapter" is the
SQLAlchemy session bound to an in-memory SQLite engine. No compose stack
is required; no in-memory doubles are used.

Fixtures here:
- ``db_engine`` — session-scoped SQLite engine + schema. Mirrors the
  approach in ``backend/tests/conftest.py``.
- ``db_session`` — per-test ``AsyncSession`` bound to the engine; the
  outer transaction is rolled back at teardown so each scenario sees an
  empty database without recreating the schema.
- ``repository_container`` — per-scenario composition root: a
  ``RestrictedSession`` wrapping ``db_session``, handed to a
  ``RepositoryContainer``. Step glue accesses both ``.metadata`` (legacy
  facade) and the new per-aggregate properties (``.projects``, etc.) off
  this single container instance to prove parity through the same DB.
- Star-import of step bindings from ``steps/`` so pytest-bdd registers
  every ``@given``/``@when``/``@then``.
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
import pytest_asyncio  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402
from uuid_utils import uuid7  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's
# registry so the .feature files resolve. Ruff would strip the import
# without the noqa marker.
sys.path.insert(0, str(Path(__file__).parent))
from steps.refactor_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Real-IO repository fixtures (DWD-1)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def db_engine():
    """Session-scoped aiosqlite engine with ProjectRecord + friends schema.

    Mirrors ``backend/tests/conftest.py``:
    - in-memory aiosqlite engine
    - ``PRAGMA foreign_keys=ON`` per connect
    - ``uuidv7()`` SQL function registered on the underlying connection
    - ``Base.metadata.create_all`` so every record table is materialised

    The engine outlives every scenario in the session; per-test isolation
    is provided by the nested-transaction pattern in ``db_session``.
    """
    from app.database import Base
    from app.infra.idempotency import IdempotencyKeyRecord  # noqa: F401 — register table

    engine = create_async_engine("sqlite+aiosqlite://", echo=False)

    @event.listens_for(engine.sync_engine, "connect")
    def _on_connect(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        dbapi_connection.create_function("uuidv7", 0, lambda: str(uuid7()))

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Per-scenario ``AsyncSession`` with automatic rollback.

    Connects to the session-scoped engine, opens an outer transaction +
    nested SAVEPOINT. Repository writes flush within the SAVEPOINT;
    scenarios can call ``session.commit()`` without escaping isolation
    because an ``after_transaction_end`` listener immediately restarts the
    nested SAVEPOINT. After the scenario, the outer transaction is rolled
    back so the next scenario sees empty tables.
    """
    conn = await db_engine.connect()
    txn = await conn.begin()
    await conn.begin_nested()

    session = AsyncSession(bind=conn, expire_on_commit=False)

    @event.listens_for(session.sync_session, "after_transaction_end")
    def _restart_savepoint(sync_session, transaction):
        if transaction.nested and not transaction._parent.nested:
            sync_session.begin_nested()

    yield session

    await session.close()
    await txn.rollback()
    await conn.close()


@pytest.fixture
def repository_container(db_session):
    """The driving port — a ``RepositoryContainer`` bound to a real session.

    Both ``.projects`` (new per-aggregate property) and ``.metadata``
    (legacy facade) resolve off this instance, sharing the same
    ``RestrictedSession``.
    """
    from app.repositories import RepositoryContainer, RestrictedSession

    return RepositoryContainer(RestrictedSession(db_session))
