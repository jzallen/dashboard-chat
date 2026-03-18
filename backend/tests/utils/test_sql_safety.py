"""Tests for centralized SQL safety utilities."""

import pytest

from app.utils.sql_safety import (
    deduplicate_column_names,
    quote_ident,
    quote_literal,
    sanitize_column_name,
    validate_condition_sql,
    validate_identifier,
    validate_s3_endpoint,
    validate_s3_key,
)


class TestQuoteIdent:
    def test_simple_name(self):
        assert quote_ident("column") == '"column"'

    def test_reserved_word(self):
        assert quote_ident("select") == '"select"'
        assert quote_ident("order") == '"order"'

    def test_embedded_double_quotes(self):
        assert quote_ident('col"name') == '"col""name"'

    def test_empty_string(self):
        assert quote_ident("") == '""'

    def test_unicode(self):
        assert quote_ident("colonne_francaise") == '"colonne_francaise"'

    def test_injection_payload(self):
        result = quote_ident('" OR 1=1 --')
        assert result == '""" OR 1=1 --"'


class TestQuoteLiteral:
    def test_simple_value(self):
        assert quote_literal("hello") == "'hello'"

    def test_embedded_single_quotes(self):
        assert quote_literal("O'Brien") == "'O''Brien'"

    def test_injection_payload(self):
        result = quote_literal("'; DROP TABLE x; --")
        assert result == "'''; DROP TABLE x; --'"

    def test_empty_string(self):
        assert quote_literal("") == "''"


class TestValidateIdentifier:
    def test_valid_simple(self):
        assert validate_identifier("column_name") == "column_name"

    def test_valid_underscore_prefix(self):
        assert validate_identifier("_private") == "_private"

    def test_valid_mixed_case(self):
        assert validate_identifier("MyColumn") == "MyColumn"

    def test_rejects_digit_prefix(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_identifier("123numeric")

    def test_rejects_special_chars(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_identifier("col; DROP TABLE x; --")

    def test_rejects_spaces(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_identifier("col name")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_identifier("")

    def test_rejects_quotes(self):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_identifier('"injection')


class TestSanitizeColumnName:
    def test_simple_name(self):
        assert sanitize_column_name("column_name") == "column_name"

    def test_spaces_replaced(self):
        assert sanitize_column_name("col with spaces") == "col_with_spaces"

    def test_special_chars_replaced(self):
        assert sanitize_column_name("Revenue ($)") == "Revenue"

    def test_leading_underscore_preserved(self):
        assert sanitize_column_name("_private") == "_private"

    def test_numeric_prefix(self):
        assert sanitize_column_name("123numeric") == "_123numeric"

    def test_injection_payload(self):
        result = sanitize_column_name("col'; DROP TABLE x; --")
        assert result == "col_DROP_TABLE_x"

    def test_reserved_word_passes(self):
        # Reserved words are valid identifiers — quoting handles them
        assert sanitize_column_name("SELECT") == "SELECT"

    def test_empty_raises(self):
        with pytest.raises(ValueError, match="empty after sanitization"):
            sanitize_column_name("")

    def test_only_special_chars_raises(self):
        with pytest.raises(ValueError, match="empty after sanitization"):
            sanitize_column_name("!@#$%")

    def test_unicode_replaced(self):
        result = sanitize_column_name("caf\u00e9")
        assert result == "caf"


class TestDeduplicateColumnNames:
    def test_no_duplicates(self):
        assert deduplicate_column_names(["a", "b", "c"]) == ["a", "b", "c"]

    def test_simple_duplicate(self):
        assert deduplicate_column_names(["col", "col"]) == ["col", "col_2"]

    def test_triple_duplicate(self):
        assert deduplicate_column_names(["col", "col", "col"]) == ["col", "col_2", "col_3"]

    def test_collision_after_sanitization(self):
        # Simulates "col-1" and "col_1" both sanitizing to "col_1"
        assert deduplicate_column_names(["col_1", "col_1"]) == ["col_1", "col_1_2"]


class TestValidateS3Endpoint:
    def test_valid_host_port(self):
        assert validate_s3_endpoint("minio:9000") == "minio:9000"

    def test_valid_hostname(self):
        assert validate_s3_endpoint("s3.amazonaws.com") == "s3.amazonaws.com"

    def test_rejects_injection(self):
        with pytest.raises(ValueError, match="Invalid S3 endpoint"):
            validate_s3_endpoint("minio'; DROP TABLE x; --")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="Invalid S3 endpoint"):
            validate_s3_endpoint("")


class TestValidateS3Key:
    def test_valid_key(self):
        assert validate_s3_key("AKIAIOSFODNN7EXAMPLE") == "AKIAIOSFODNN7EXAMPLE"

    def test_valid_with_slashes(self):
        assert validate_s3_key("wJalrXUtnFEMI/K7MDENG+bPxRfi") == "wJalrXUtnFEMI/K7MDENG+bPxRfi"

    def test_rejects_injection(self):
        with pytest.raises(ValueError, match="Invalid S3 key"):
            validate_s3_key("key'; DROP TABLE x; --")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="Invalid S3 key"):
            validate_s3_key("")


class TestValidateConditionSql:
    def test_valid_where_clause(self):
        assert validate_condition_sql("age > 18") == "age > 18"

    def test_valid_complex_condition(self):
        result = validate_condition_sql("status = 'active' AND age >= 21")
        assert result == "status = 'active' AND age >= 21"

    def test_rejects_multiple_statements(self):
        with pytest.raises(ValueError, match="Multiple SQL statements"):
            validate_condition_sql("age > 18; DROP TABLE users")

    def test_rejects_drop(self):
        with pytest.raises(ValueError, match="Forbidden SQL operation"):
            validate_condition_sql("DROP TABLE users")

    def test_rejects_insert(self):
        with pytest.raises(ValueError, match="Forbidden SQL operation"):
            validate_condition_sql("INSERT INTO users VALUES (1)")

    def test_rejects_read_csv(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_csv('/etc/passwd')")

    def test_rejects_read_parquet(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_parquet('s3://bucket/file.parquet')")

    def test_rejects_system(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("system('rm -rf /')")

    def test_rejects_attach(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("attach('/tmp/evil.db')")

    def test_rejects_install(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("install('httpfs')")

    def test_rejects_load(self):
        # sqlglot parses LOAD as a Command node, caught by DDL/DML check
        with pytest.raises(ValueError, match="Forbidden SQL operation"):
            validate_condition_sql("load('httpfs')")

    def test_rejects_glob_bare(self):
        """Bare glob() is parsed as exp.Glob by sqlglot — must be caught."""
        with pytest.raises(ValueError, match=r"Dangerous function.*glob"):
            validate_condition_sql("glob('/etc/passwd')")

    def test_rejects_glob_in_where(self):
        """glob used as an operator in WHERE clause must be caught."""
        with pytest.raises(ValueError, match=r"Dangerous function.*glob"):
            validate_condition_sql("name GLOB '/tmp/*'")

    def test_rejects_glob_in_subquery(self):
        with pytest.raises(ValueError, match="Multiple SQL statements"):
            validate_condition_sql("1=1; SELECT * FROM glob('/tmp/*')")

    def test_rejects_sniff_csv(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("sniff_csv('/etc/passwd')")

    def test_rejects_copy(self):
        # sqlglot parses COPY as a Command node, caught by DDL/DML check
        with pytest.raises(ValueError, match="Forbidden SQL operation"):
            validate_condition_sql("copy('data.csv')")

    def test_rejects_read_text(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_text('/etc/passwd')")

    def test_rejects_read_json(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_json('http://evil.com/data.json')")

    def test_rejects_read_json_auto(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_json_auto('http://evil.com/data.json')")

    def test_rejects_read_csv_auto(self):
        with pytest.raises(ValueError, match="Dangerous function"):
            validate_condition_sql("read_csv_auto('/etc/passwd')")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="Empty condition SQL"):
            validate_condition_sql("")

    def test_valid_in_clause(self):
        result = validate_condition_sql("status IN ('active', 'pending')")
        assert "status" in result

    def test_valid_like(self):
        result = validate_condition_sql("name LIKE '%smith%'")
        assert "name" in result
