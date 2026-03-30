"""Tests for hardened DuckDB connection factory."""

from app.utils.duckdb_factory import create_hardened_duckdb_connection


class TestHardenedConnection:
    def test_basic_query_still_works(self):
        conn = create_hardened_duckdb_connection()
        result = conn.raw_sql("SELECT 1 AS x")
        assert result.fetchone()[0] == 1

    def test_httpfs_is_loaded(self):
        conn = create_hardened_duckdb_connection()
        result = conn.raw_sql("SELECT * FROM duckdb_extensions() WHERE extension_name = 'httpfs' AND loaded = true")
        assert result.fetchone() is not None

    def test_s3_configurator_hook_is_called(self):
        calls = []

        def mock_configurator(conn):
            calls.append(conn)

        create_hardened_duckdb_connection(s3_configurator=mock_configurator)
        assert len(calls) == 1

    def test_s3_configurator_overrides_configure_s3_flag(self):
        """When s3_configurator is provided, configure_s3=True is ignored."""
        hook_called = []

        def mock_configurator(conn):
            hook_called.append(True)

        conn = create_hardened_duckdb_connection(configure_s3=True, s3_configurator=mock_configurator)
        assert len(hook_called) == 1
        result = conn.raw_sql("SELECT 1 AS x")
        assert result.fetchone()[0] == 1
