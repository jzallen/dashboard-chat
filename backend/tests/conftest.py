"""Pytest configuration and fixtures.

Session-scoped engine and S3 mock eliminate per-test setup overhead.
Per-test isolation is achieved via nested transactions (SAVEPOINT) that
roll back after each test — tests see empty tables without recreating
the schema or re-entering mock_aws each time.
"""

import sys
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.database import Base
from tests.uuidv7_fixtures import make_test_uuidv7

# Add backend directory to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


@pytest.fixture(scope="session")
def mock_s3():
    """Session-scoped S3 mock via moto.

    Enters mock_aws once for the entire test session. Domain conftest files
    that need S3 should use auto_mock_s3 (autouse) which depends on this.
    """
    from moto import mock_aws

    with mock_aws():
        import boto3

        from app.config import get_settings

        settings = get_settings()
        s3 = boto3.client(
            "s3",
            region_name="us-east-1",
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
        s3.create_bucket(Bucket=settings.storage_bucket)

        yield s3


_engine = None


def _get_engine():
    """Lazily create and cache the session-scoped test engine."""
    global _engine
    if _engine is None:
        _engine = create_async_engine("sqlite+aiosqlite://", echo=False)
        _test_uuidv7 = make_test_uuidv7()

        @event.listens_for(_engine.sync_engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
            dbapi_connection.create_function("uuidv7", 0, _test_uuidv7)

    return _engine


_schema_created = False


@pytest.fixture
async def db_session():
    """Per-test database session with automatic rollback.

    On first use, creates an in-memory SQLite engine and schema (cached
    for the process lifetime). Each test gets a connection wrapped in a
    transaction with a nested SAVEPOINT. session.commit() releases the
    SAVEPOINT and a listener immediately starts a new one, so multiple
    commits work. After the test, the outer transaction is rolled back,
    restoring the database to its pre-test state.
    """
    global _schema_created
    engine = _get_engine()

    if not _schema_created:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        _schema_created = True

    conn = await engine.connect()
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
