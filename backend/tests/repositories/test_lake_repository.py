"""Characterization tests for BaseLakeRepository SQL identifier hygiene.

These tests pin the contract that ``BaseLakeRepository.get_parquet_column_type``
routes its column-name interpolation through
:func:`app.utils.sql_safety.quote_ident` so the emitted SQL survives edge
characters in column names (embedded double-quotes, delimiters, mixed case,
SQL-keyword-like identifiers).

Closes Gap 3 of ADR-026 (MR-4). The lake repository sits below the
SQL-compilation layer; column names originate from
``dataset.schema_config``, not directly from user input, so this is an
internal hygiene fix — but it is the last inline f-string column
interpolation in the lake-repo read path and removes a latent bug that
would corrupt the emitted SQL for any column containing a double-quote.

Mock policy: mocks live ONLY at the asyncpg port boundary
(``pool.acquire`` / ``conn.fetchrow``). The driving port for these tests
is the public ``BaseLakeRepository.get_parquet_column_type`` coroutine; no
internal helpers are mocked.
"""

import pytest

from app.repositories.lake.repository import BaseLakeRepository


class _CapturingConn:
    """Captures the SQL string passed to ``fetchrow`` and returns a stub row."""

    def __init__(self) -> None:
        self.captured_sql: str | None = None

    async def fetchrow(self, sql: str) -> dict:
        self.captured_sql = sql
        return {"col_type": "VARCHAR"}


class _AcquireCtx:
    def __init__(self, conn: _CapturingConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _CapturingConn:
        return self._conn

    async def __aexit__(self, *_exc: object) -> bool:
        return False


class _Pool:
    def __init__(self, conn: _CapturingConn) -> None:
        self._conn = conn

    def acquire(self) -> _AcquireCtx:
        return _AcquireCtx(self._conn)


def _make_repo_with_capture(monkeypatch: pytest.MonkeyPatch) -> tuple[BaseLakeRepository, _CapturingConn]:
    """Construct a repo whose query engine pool returns a SQL-capturing conn."""
    conn = _CapturingConn()
    pool = _Pool(conn)

    async def _fake_get_pool(self: BaseLakeRepository) -> _Pool:
        return pool

    monkeypatch.setattr(BaseLakeRepository, "_get_query_engine_pool", _fake_get_pool)
    # s3_client=None is safe here — get_parquet_column_type uses only the
    # query engine path, not the boto3 client.
    return BaseLakeRepository(s3_client=None, bucket="test-bucket"), conn


class TestGetParquetColumnTypeIdentifierHygiene:
    """``get_parquet_column_type`` quotes the column identifier via quote_ident.

    These assertions pin the exact emitted SQL byte-for-byte. The normal
    identifier case (``region``) produces SQL that is byte-identical to the
    pre-fix legacy form, proving the hygiene fix is a no-op for the happy
    path. The edge-character cases fail under the legacy raw-interpolation
    form and pass only after quote_ident is wired in.
    """

    @pytest.mark.asyncio
    async def test_quotes_normal_identifier(self, monkeypatch: pytest.MonkeyPatch) -> None:
        repo, conn = _make_repo_with_capture(monkeypatch)

        result = await repo.get_parquet_column_type("data/file.parquet", "region")

        assert conn.captured_sql == (
            "SELECT typeof(\"region\") AS col_type FROM read_parquet('s3://test-bucket/data/file.parquet') LIMIT 1"
        )
        assert result == "varchar"

    @pytest.mark.asyncio
    async def test_doubles_embedded_double_quotes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Embedded double-quotes must be doubled inside the quoted identifier.

        Under the legacy raw-interpolation form the SQL would emit
        ``typeof("col"with"quote")`` — three orphan double-quotes that
        terminate the identifier early and corrupt the prepared statement.
        ``quote_ident`` doubles every embedded ``"`` so the identifier
        parses as a single token.
        """
        repo, conn = _make_repo_with_capture(monkeypatch)

        await repo.get_parquet_column_type("data/file.parquet", 'col"with"quote')

        assert conn.captured_sql == (
            'SELECT typeof("col""with""quote") AS col_type '
            "FROM read_parquet('s3://test-bucket/data/file.parquet') LIMIT 1"
        )

    @pytest.mark.asyncio
    async def test_preserves_embedded_delimiter(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Embedded commas pass through unchanged inside the quoted identifier."""
        repo, conn = _make_repo_with_capture(monkeypatch)

        await repo.get_parquet_column_type("data/file.parquet", "col,region")

        assert conn.captured_sql == (
            "SELECT typeof(\"col,region\") AS col_type FROM read_parquet('s3://test-bucket/data/file.parquet') LIMIT 1"
        )

    @pytest.mark.asyncio
    async def test_preserves_mixed_case(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Mixed-case identifiers are preserved verbatim inside the quotes.

        Without quoting, most SQL engines fold identifiers to lower case;
        the quoted form preserves the schema-declared casing.
        """
        repo, conn = _make_repo_with_capture(monkeypatch)

        await repo.get_parquet_column_type("data/file.parquet", "MyCol")

        assert conn.captured_sql == (
            "SELECT typeof(\"MyCol\") AS col_type FROM read_parquet('s3://test-bucket/data/file.parquet') LIMIT 1"
        )

    @pytest.mark.asyncio
    async def test_quotes_sql_keyword_identifier(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """SQL-keyword-like column names are protected by quoting.

        A column literally named ``select`` would collide with the SELECT
        keyword if unquoted; the quoted form keeps it as a regular identifier.
        """
        repo, conn = _make_repo_with_capture(monkeypatch)

        await repo.get_parquet_column_type("data/file.parquet", "select")

        assert conn.captured_sql == (
            "SELECT typeof(\"select\") AS col_type FROM read_parquet('s3://test-bucket/data/file.parquet') LIMIT 1"
        )
