"""Live integration test for pg_duckdb multi-column reads via asyncpg.

Regression for dc-f8m: ``GET /api/datasets/{id}?include_preview=true`` returned
HTTP 500 with ``asyncpg.exceptions._base.ProtocolError: the number of columns
in the result row (N) is different from what was described (1)`` because
pg_duckdb's prepared-statement Describe phase reports a single column for
``read_parquet`` queries while Execute returns the actual N columns. dc-dex's
``statement_cache_size=0`` did not address the mismatch (asyncpg's extended
protocol always issues Describe). The fix wraps queries in ``to_json(t)`` so
Describe and Execute both see one column.

This test deliberately avoids mocks at the asyncpg port. It connects to a
running ``query-engine`` (pg_duckdb) and ``minio`` and uploads a real
multi-column Parquet, then exercises the lake-repo preview path. Without the
``wrap_for_asyncpg`` fix, ``conn.fetch`` raises ``ProtocolError`` and the
test fails — that is its purpose.

Skipped when services are unreachable (e.g. CI without docker compose). To
run locally::

    docker compose up -d minio query-engine
    QUERY_ENGINE_HOST=localhost QUERY_ENGINE_PORT=5433 \\
    MINIO_ENDPOINT=localhost:9000 \\
    uv run pytest backend/tests/integration/test_lake_preview_live.py -v
"""

import contextlib
import io
import os
import socket
import uuid
from collections.abc import AsyncIterator

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from botocore.config import Config

from app.repositories.lake.repository import BaseLakeRepository

# Multi-column fixture matches the production preview path (N > 1) which is
# the precise shape that triggers the Describe-vs-Execute mismatch.
FIXTURE_COLUMNS = ["name", "age", "active", "score", "city"]
FIXTURE_ROWS = [
    {"name": "Alice", "age": 30, "active": True, "score": 95.5, "city": "NYC"},
    {"name": "Bob", "age": 25, "active": False, "score": 82.1, "city": "SF"},
    {"name": "Carol", "age": 41, "active": True, "score": 70.0, "city": "LA"},
]


def _service_reachable(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _query_engine_settings() -> dict:
    return {
        "host": os.environ.get("QUERY_ENGINE_HOST", "localhost"),
        "port": int(os.environ.get("QUERY_ENGINE_PORT", "5433")),
        "user": os.environ.get("QUERY_ENGINE_ADMIN_USER", "duckdb_admin"),
        "password": os.environ.get("QUERY_ENGINE_ADMIN_PASSWORD", "duckdb_secret"),
        "database": os.environ.get("QUERY_ENGINE_DATABASE", "dashboard_external"),
    }


def _minio_settings() -> dict:
    """MinIO endpoint pair.

    ``host_endpoint`` is what boto3 (running on the host) uses; ``internal_endpoint``
    is what the query-engine container uses (the docker-network alias). They
    differ when the test runs against ``docker compose up -d minio query-engine``
    — boto3 hits ``localhost:9000`` while pg_duckdb inside the container reaches
    MinIO at ``minio:9000``.
    """
    host_endpoint = os.environ.get("MINIO_ENDPOINT", "localhost:9000")
    internal_endpoint = os.environ.get("MINIO_INTERNAL_ENDPOINT", "minio:9000")
    return {
        "host_endpoint": host_endpoint,
        "internal_endpoint": internal_endpoint,
        "access_key": os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        "secret_key": os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        "bucket": os.environ.get("STORAGE_BUCKET", "dashboard-chat.datalake"),
    }


def _live_services_available() -> bool:
    qe = _query_engine_settings()
    if not _service_reachable(qe["host"], qe["port"]):
        return False
    mn = _minio_settings()
    host, _, port = mn["host_endpoint"].partition(":")
    return _service_reachable(host, int(port or 9000))


pytestmark = pytest.mark.skipif(
    not _live_services_available(),
    reason="query-engine and/or minio not reachable; run `docker compose up -d minio query-engine`",
)


@pytest.fixture
def s3_client():
    settings = _minio_settings()
    client = boto3.client(
        "s3",
        endpoint_url=f"http://{settings['host_endpoint']}",
        aws_access_key_id=settings["access_key"],
        aws_secret_access_key=settings["secret_key"],
        region_name="us-east-1",
        config=Config(signature_version="s3v4"),
    )
    try:
        client.head_bucket(Bucket=settings["bucket"])
    except Exception:
        client.create_bucket(Bucket=settings["bucket"])
    return client


@pytest.fixture
def fixture_parquet_bytes() -> bytes:
    table = pa.Table.from_pylist(FIXTURE_ROWS)
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


@pytest.fixture
async def uploaded_parquet_path(s3_client, fixture_parquet_bytes) -> AsyncIterator[str]:
    settings = _minio_settings()
    storage_path = f"datasets/test-{uuid.uuid4().hex}/data.parquet"
    s3_client.put_object(Bucket=settings["bucket"], Key=storage_path, Body=fixture_parquet_bytes)
    try:
        yield storage_path
    finally:
        with contextlib.suppress(Exception):
            s3_client.delete_object(Bucket=settings["bucket"], Key=storage_path)


@pytest.fixture
async def live_query_engine_pool():
    """Create a pool against the live query-engine, install the MinIO secret.

    Independent of ``app.database.get_query_engine_pool`` so the test does not
    depend on process-global state and can run alongside other tests.
    """
    import asyncpg

    from app.infra.query_engine_secrets import ensure_minio_secret
    from app.use_cases.sql_access._infra import StorageConfig

    qe = _query_engine_settings()
    mn = _minio_settings()
    pool = await asyncpg.create_pool(
        host=qe["host"],
        port=qe["port"],
        user=qe["user"],
        password=qe["password"],
        database=qe["database"],
        min_size=1,
        max_size=2,
        statement_cache_size=0,
        max_cached_statement_lifetime=0,
    )
    storage_config = StorageConfig(
        endpoint=mn["internal_endpoint"],
        access_key=mn["access_key"],
        secret_key=mn["secret_key"],
        region="us-east-1",
        url_style="path",
        use_ssl=False,
    )
    async with pool.acquire() as conn:
        await ensure_minio_secret(conn, storage_config)
    try:
        yield pool
    finally:
        await pool.close()


class TestLakeRepoPreviewLive:
    """Exercises the asyncpg port end-to-end against pg_duckdb + MinIO.

    Without ``wrap_for_asyncpg`` at the lake-repo call site, ``conn.fetch``
    raises ``asyncpg.exceptions.ProtocolError`` for multi-column Parquet
    reads. With it, the rows come back intact.
    """

    async def test_read_parquet_preview_returns_all_columns_for_multi_column_parquet(
        self,
        s3_client,
        uploaded_parquet_path,
        live_query_engine_pool,
    ):
        bucket = _minio_settings()["bucket"]
        repo = BaseLakeRepository(s3_client=s3_client, bucket=bucket)

        # Patch the pool accessor to use the test-scoped pool rather than the
        # process-global one. We are NOT mocking asyncpg itself — only redirecting
        # which live pool the repo uses.
        async def _use_test_pool():
            return live_query_engine_pool

        repo._get_query_engine_pool = _use_test_pool  # type: ignore[method-assign]

        rows = await repo.read_parquet_preview(uploaded_parquet_path, limit=10)

        assert len(rows) == len(FIXTURE_ROWS)
        assert set(rows[0].keys()) == set(FIXTURE_COLUMNS)
        names = {r["name"] for r in rows}
        assert names == {r["name"] for r in FIXTURE_ROWS}

    async def test_unwrapped_multi_column_read_raises_protocol_error(
        self,
        s3_client,
        uploaded_parquet_path,
        live_query_engine_pool,
    ):
        """Confirms the underlying bug exists: a bare ``SELECT *`` from
        ``read_parquet`` over asyncpg raises ``ProtocolError``. This is the
        symptom the wrapper sidesteps; if this assertion ever stops holding
        (e.g. asyncpg or pg_duckdb fix the underlying mismatch), the wrapper
        becomes redundant and the production code can be simplified.
        """
        import asyncpg

        bucket = _minio_settings()["bucket"]
        s3_path = f"s3://{bucket}/{uploaded_parquet_path}"

        async with live_query_engine_pool.acquire() as conn:
            with pytest.raises(asyncpg.exceptions.ProtocolError):
                await conn.fetch(f"SELECT * FROM read_parquet('{s3_path}') LIMIT 10")
