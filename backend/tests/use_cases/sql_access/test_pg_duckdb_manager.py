"""Tests for pg_duckdb_manager utility functions and SQL construction."""

from unittest.mock import AsyncMock, MagicMock, patch

import bcrypt
import pytest

from app.use_cases.sql_access.pg_duckdb_manager import (
    DUCKDB_READERS_GROUP,
    schema_name,
    role_name,
    generate_password,
    hash_password,
    build_create_role_sql,
    build_alter_role_password_sql,
    ensure_duckdb_role_configured,
    _validate_ident,
    _quote_ident,
    _quote_literal,
    PASSWORD_LENGTH,
)
from app.use_cases.sql_access.provisioner import ProjectEnvironment


MOCK_ENV = ProjectEnvironment(
    environment_id="test-env-id",
    host="localhost",
    port=15432,
    database="dashboard_external",
    admin_user="duckdb_admin",
    admin_password="duckdb_secret",
)


class TestNamingConventions:

    def test_schema_name_uses_first_8_chars(self):
        assert schema_name("abcdef12-3456-7890-abcd-ef1234567890") == "project_abcdef12"

    def test_role_name_uses_first_8_chars(self):
        assert role_name("abcdef12-3456-7890-abcd-ef1234567890") == "reader_abcdef12"

    def test_schema_name_deterministic(self):
        pid = "12345678-aaaa-bbbb-cccc-dddddddddddd"
        assert schema_name(pid) == schema_name(pid)

    def test_different_projects_get_different_names(self):
        assert schema_name("aaaaaaaa-1111") != schema_name("bbbbbbbb-2222")


class TestPasswordGeneration:

    def test_generate_password_correct_length(self):
        pw = generate_password()
        assert len(pw) == PASSWORD_LENGTH

    def test_generate_password_alphanumeric(self):
        pw = generate_password()
        assert pw.isalnum()

    def test_generate_password_unique(self):
        passwords = {generate_password() for _ in range(100)}
        assert len(passwords) == 100  # Statistically should all be unique

    def test_hash_password_is_valid_bcrypt(self):
        pw = "testpassword123"
        hashed = hash_password(pw)
        assert hashed.startswith("$2b$")
        assert bcrypt.checkpw(pw.encode(), hashed.encode())

    def test_hash_password_different_for_same_input(self):
        pw = "testpassword123"
        h1 = hash_password(pw)
        h2 = hash_password(pw)
        assert h1 != h2  # Different salts


class TestIdentifierValidation:

    def test_validate_ident_accepts_safe_names(self):
        assert _validate_ident("project_abcdef12") == "project_abcdef12"
        assert _validate_ident("reader_12345678") == "reader_12345678"

    def test_validate_ident_rejects_special_chars(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_ident("role; DROP TABLE--")

    def test_validate_ident_rejects_quotes(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_ident('role"injection')

    def test_validate_ident_rejects_empty(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_ident("")

    def test_validate_ident_rejects_starting_with_number(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            _validate_ident("123abc")


class TestSqlEscaping:

    def test_quote_ident_basic(self):
        assert _quote_ident("project_abc") == '"project_abc"'

    def test_quote_ident_escapes_double_quotes(self):
        assert _quote_ident('my"ident') == '"my""ident"'

    def test_quote_literal_basic(self):
        assert _quote_literal("password123") == "'password123'"

    def test_quote_literal_escapes_single_quotes(self):
        assert _quote_literal("pass'word") == "'pass''word'"

    def test_quote_literal_double_single_quotes(self):
        assert _quote_literal("it''s") == "'it''''s'"


class TestSqlConstruction:
    """Tests for SQL statement builders — CRITICAL-1 coverage."""

    def test_build_create_role_sql_default_connection_limit(self):
        sql = build_create_role_sql("reader_abcdef12", "mypassword123", connection_limit=10)
        assert sql == (
            'CREATE ROLE "reader_abcdef12" LOGIN PASSWORD \'mypassword123\''
            ' CONNECTION LIMIT 10'
        )

    def test_build_create_role_sql_custom_connection_limit(self):
        sql = build_create_role_sql("reader_abcdef12", "mypassword123", connection_limit=20)
        assert "CONNECTION LIMIT 20" in sql

    def test_build_create_role_sql_escapes_password_with_single_quote(self):
        sql = build_create_role_sql("reader_abcdef12", "pass'word", connection_limit=10)
        assert "pass''word" in sql
        # Should NOT contain an unescaped single quote that breaks the statement
        assert "PASSWORD 'pass''word'" in sql

    def test_build_create_role_sql_rejects_invalid_role(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            build_create_role_sql("role; DROP TABLE--", "password", connection_limit=10)

    def test_build_alter_role_password_sql_basic(self):
        sql = build_alter_role_password_sql("reader_abcdef12", "newpass123")
        assert sql == 'ALTER ROLE "reader_abcdef12" PASSWORD \'newpass123\''

    def test_build_alter_role_password_sql_escapes_password(self):
        sql = build_alter_role_password_sql("reader_abcdef12", "new'pass")
        assert "PASSWORD 'new''pass'" in sql

    def test_build_alter_role_password_sql_rejects_invalid_role(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            build_alter_role_password_sql("invalid role!", "password")


class TestEnsureDuckdbRoleConfigured:
    """Tests for ensure_duckdb_role_configured — idempotent GUC setup."""

    @patch("app.use_cases.sql_access.pg_duckdb_manager._get_connection")
    async def test_creates_group_role_and_sets_guc(self, mock_get_conn):
        conn = AsyncMock()
        mock_get_conn.return_value = conn

        await ensure_duckdb_role_configured(MOCK_ENV)

        # Should execute 3 statements: DO block, ALTER SYSTEM, pg_reload_conf
        assert conn.execute.await_count == 3

        calls = [c.args[0] for c in conn.execute.await_args_list]
        # First: CREATE ROLE in DO block
        assert "CREATE ROLE" in calls[0]
        assert DUCKDB_READERS_GROUP in calls[0]
        assert "NOLOGIN" in calls[0]
        # Second: ALTER SYSTEM SET
        assert "ALTER SYSTEM SET duckdb.postgres_role" in calls[1]
        assert DUCKDB_READERS_GROUP in calls[1]
        # Third: pg_reload_conf
        assert "pg_reload_conf" in calls[2]
        # Connection closed
        conn.close.assert_awaited_once()

    @patch("app.use_cases.sql_access.pg_duckdb_manager._get_connection")
    async def test_idempotent_no_error_on_second_call(self, mock_get_conn):
        """Calling ensure_duckdb_role_configured twice should not raise."""
        conn = AsyncMock()
        mock_get_conn.return_value = conn

        await ensure_duckdb_role_configured(MOCK_ENV)
        await ensure_duckdb_role_configured(MOCK_ENV)

        # Each call makes 3 executions
        assert conn.execute.await_count == 6

    @patch("app.use_cases.sql_access.pg_duckdb_manager._get_connection")
    async def test_closes_connection_on_error(self, mock_get_conn):
        conn = AsyncMock()
        conn.execute = AsyncMock(side_effect=Exception("DB error"))
        mock_get_conn.return_value = conn

        with pytest.raises(Exception, match="DB error"):
            await ensure_duckdb_role_configured(MOCK_ENV)

        conn.close.assert_awaited_once()


class TestConfigureS3SecretsPersistent:
    """Test that configure_s3_secrets uses PERSISTENT keyword."""

    @patch("app.use_cases.sql_access.pg_duckdb_manager._get_connection")
    async def test_secret_sql_contains_persistent(self, mock_get_conn):
        from app.use_cases.sql_access.pg_duckdb_manager import configure_s3_secrets
        from app.use_cases.sql_access.provisioner import StorageConfig

        conn = AsyncMock()
        mock_get_conn.return_value = conn

        storage_config = StorageConfig(
            endpoint="minio:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
            region="us-east-1",
            url_style="path",
            use_ssl=False,
        )

        await configure_s3_secrets(MOCK_ENV, storage_config)

        executed_sql = conn.execute.await_args_list[0].args[0]
        assert "CREATE OR REPLACE PERSISTENT SECRET" in executed_sql
        conn.close.assert_awaited_once()
