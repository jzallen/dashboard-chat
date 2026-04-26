"""Tests for database.py — query engine pool initialization.

Regression for dc-6gg: the asyncpg pool used by the lake-repo preview path
must have a MinIO persistent secret configured at first acquire, sourced
from app settings. Without it, `read_parquet('s3://...')` falls through
to AWS S3 with empty region and 404s.

The seam under test is the asyncpg port: we spy at `asyncpg.create_pool`
and the resulting connection's `execute`. We do NOT patch internals of
the helper module — that would be an implementation-mirroring test.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import database
from app.config import get_settings


@pytest.fixture(autouse=True)
async def reset_pool_and_settings():
    """Each test starts with a fresh pool global and a clean settings cache."""
    database._query_engine_pool = None
    get_settings.cache_clear()
    yield
    database._query_engine_pool = None
    get_settings.cache_clear()


def _fake_pool_with_spy_conn(spy_conn):
    """Build a fake asyncpg pool whose acquire() yields the spy connection."""
    pool = MagicMock()

    @asynccontextmanager
    async def _acquire():
        yield spy_conn

    pool.acquire = _acquire
    pool.close = AsyncMock()
    return pool


class TestQueryEnginePoolMinioSecret:
    async def test_first_acquire_creates_persistent_minio_secret_from_settings(self):
        spy_conn = AsyncMock()
        spy_conn.execute = AsyncMock()
        fake_pool = _fake_pool_with_spy_conn(spy_conn)

        with patch("asyncpg.create_pool", new=AsyncMock(return_value=fake_pool)):
            pool = await database.get_query_engine_pool()

        assert pool is fake_pool
        assert spy_conn.execute.await_count == 1
        sql = spy_conn.execute.await_args.args[0]
        assert "CREATE OR REPLACE PERSISTENT SECRET minio_secret" in sql
        assert "TYPE S3" in sql
        # Defaults from app.config.Settings.
        assert "'minioadmin'" in sql  # access_key + secret_key
        assert "'us-east-1'" in sql  # s3_region
        assert "'path'" in sql  # url_style
        assert "USE_SSL false" in sql  # minio_secure default

    async def test_second_call_reuses_pool_and_does_not_re_set_secret(self):
        spy_conn = AsyncMock()
        spy_conn.execute = AsyncMock()
        fake_pool = _fake_pool_with_spy_conn(spy_conn)

        with patch("asyncpg.create_pool", new=AsyncMock(return_value=fake_pool)) as create:
            await database.get_query_engine_pool()
            await database.get_query_engine_pool()

        assert create.await_count == 1
        assert spy_conn.execute.await_count == 1

    async def test_uses_internal_endpoint_when_set(self):
        spy_conn = AsyncMock()
        spy_conn.execute = AsyncMock()
        fake_pool = _fake_pool_with_spy_conn(spy_conn)

        with (
            patch.dict(
                "os.environ",
                {"MINIO_INTERNAL_ENDPOINT": "minio:9000", "MINIO_ENDPOINT": "localhost:9000"},
            ),
            patch("asyncpg.create_pool", new=AsyncMock(return_value=fake_pool)),
        ):
            get_settings.cache_clear()
            await database.get_query_engine_pool()

        sql = spy_conn.execute.await_args.args[0]
        assert "ENDPOINT 'minio:9000'" in sql
