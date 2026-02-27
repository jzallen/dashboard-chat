"""Pytest configuration and fixtures."""

import sys
import tempfile
from pathlib import Path

import pytest
from moto import mock_aws
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import Base
from tests.uuidv7_fixtures import make_test_uuidv7

# Add backend directory to path for imports
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


@pytest.fixture(autouse=True)
def mock_s3():
    """Auto-use fixture that mocks all AWS S3 calls via moto.

    This runs for every test automatically, ensuring boto3 S3 calls
    go to moto's in-memory mock instead of real S3/MinIO.
    """
    with mock_aws():
        # Create the test bucket that MinIOLakeRepository expects
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


@pytest.fixture
async def db_session():
    """Create a temporary SQLite database and session for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
    )

    # Enable foreign keys and register deterministic uuidv7() for SQLite
    _test_uuidv7 = make_test_uuidv7()

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        dbapi_connection.create_function("uuidv7", 0, _test_uuidv7)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_factory() as session:
        yield session

    await engine.dispose()
