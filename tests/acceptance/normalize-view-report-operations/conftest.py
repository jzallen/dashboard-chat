# <!-- DES-ENFORCEMENT : exempt -->
"""Acceptance-test configuration for normalize-view-report-operations (ADR-052).

DWD-1: walking-skeleton strategy C-local — real SQLAlchemy + in-memory SQLite +
real ibis->DuckDB rendering. The repository layer's real adapter is the
SQLAlchemy session bound to an in-memory SQLite engine (the same engine
``backend/tests/conftest.py`` uses); the renderer's real adapter is
``ibis.to_sql(dialect="duckdb")``. No compose stack is required; no in-memory
doubles are used. If the real SQLite adapter or the real ibis renderer were
swapped for a stub, the render-equivalence characterization would silently pass
and prove nothing about the refactor's wiring (Mandate 6 litmus test).

Fixtures here:
- ``db_engine`` — session-scoped aiosqlite engine + schema. Mirrors
  ``backend/tests/conftest.py``.
- ``db_session`` — per-scenario ``AsyncSession`` bound to the engine; the outer
  transaction is rolled back at teardown (nested SAVEPOINT pattern) so each
  scenario sees empty tables without recreating the schema.
- ``repository_container`` — the driving port: a ``RepositoryContainer`` wrapping
  a ``RestrictedSession`` over ``db_session``. Step glue reaches view/report
  persistence through ``.metadata`` (``create_view`` / ``get_view`` /
  ``create_report`` / ``get_report``) and drives the ``create_view`` /
  ``create_report`` use-case functions for the validation-boundary scenarios.
- ``auth_context`` — sets the session + a dev auth user in the context vars the
  ``with_repositories`` / ``handle_returns`` decorators read, so the use-case
  functions run against this suite's session.
- Star-import of step bindings from ``steps/`` so pytest-bdd registers every
  ``@given``/``@when``/``@then``.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the backend's `app` package importable. Acceptance suite lives at the
# repo root; backend is at `backend/`. Mirrors the sys.path discipline in the
# sibling refactor-metadata-repository-split/conftest.py.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402
from uuid_utils import uuid7  # noqa: E402

# Star-import binds the @given/@when/@then bindings into pytest-bdd's registry
# so the .feature files resolve. Ruff would strip the import without the noqa.
sys.path.insert(0, str(Path(__file__).parent))
from steps.relation_steps import *  # noqa: E402,F401,F403


# ---------------------------------------------------------------------------
# Real-IO fixtures (DWD-1)
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def db_engine():
    """Session-scoped aiosqlite engine with the full record schema.

    Mirrors ``backend/tests/conftest.py``:
    - in-memory aiosqlite engine
    - ``PRAGMA foreign_keys=ON`` per connect
    - ``uuidv7()`` SQL function registered on the underlying connection
    - ``Base.metadata.create_all`` so every record table is materialised

    The engine outlives every scenario in the session; per-test isolation is the
    nested-transaction pattern in ``db_session``.
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

    Opens an outer transaction + nested SAVEPOINT; an ``after_transaction_end``
    listener restarts the SAVEPOINT so scenarios may ``commit()`` without
    escaping isolation. After the scenario the outer transaction rolls back so
    the next scenario sees empty tables.
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

    View/report persistence resolves through ``.metadata`` (``create_view`` /
    ``get_view`` / ``create_report`` / ``get_report``); the validation-boundary
    scenarios drive the ``create_view`` / ``create_report`` use-case functions
    with ``repositories=<this container>``.
    """
    from app.repositories import RepositoryContainer, RestrictedSession

    return RepositoryContainer(RestrictedSession(db_session))


@pytest.fixture
def auth_context(db_session):
    """Bind the session + a dev auth user into the context vars the use-case
    decorators read, so ``create_view`` / ``create_report`` run against this
    suite's session.

    The ``with_repositories`` decorator calls ``get_session()`` at the top of its
    wrapper; the use-case functions expect an auth user in context. This fixture
    supplies both. Scenarios that seed only through ``RepositoryContainer.metadata``
    do not require it, but the boundary-validation scenarios that drive the
    use-case functions do.
    """
    from app.auth.context import clear_auth_user, set_auth_user
    from app.auth.types import AuthUser
    from app.repositories import set_session

    set_session(db_session)
    set_auth_user(
        AuthUser(id="acceptance-user", email="acceptance@example.com", org_id="dev-org-001")
    )

    yield

    clear_auth_user()
