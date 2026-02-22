"""Tests for pg_duckdb_manager utility functions and SQL construction."""

import bcrypt
import pytest

from app.use_cases.sql_access.pg_duckdb_manager import (
    schema_name,
    role_name,
    generate_password,
    hash_password,
    build_create_role_sql,
    build_alter_role_password_sql,
    _validate_ident,
    _quote_ident,
    _quote_literal,
    PASSWORD_LENGTH,
    CONNECTION_LIMIT,
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

    def test_build_create_role_sql_basic(self):
        sql = build_create_role_sql("reader_abcdef12", "mypassword123")
        assert sql == (
            'CREATE ROLE "reader_abcdef12" LOGIN PASSWORD \'mypassword123\''
            f' CONNECTION LIMIT {CONNECTION_LIMIT}'
        )

    def test_build_create_role_sql_escapes_password_with_single_quote(self):
        sql = build_create_role_sql("reader_abcdef12", "pass'word")
        assert "pass''word" in sql
        # Should NOT contain an unescaped single quote that breaks the statement
        assert "PASSWORD 'pass''word'" in sql

    def test_build_create_role_sql_rejects_invalid_role(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            build_create_role_sql("role; DROP TABLE--", "password")

    def test_build_alter_role_password_sql_basic(self):
        sql = build_alter_role_password_sql("reader_abcdef12", "newpass123")
        assert sql == 'ALTER ROLE "reader_abcdef12" PASSWORD \'newpass123\''

    def test_build_alter_role_password_sql_escapes_password(self):
        sql = build_alter_role_password_sql("reader_abcdef12", "new'pass")
        assert "PASSWORD 'new''pass'" in sql

    def test_build_alter_role_password_sql_rejects_invalid_role(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            build_alter_role_password_sql("invalid role!", "password")
