"""Tests for dataset upload and schema inference.

These tests verify the schema inference logic without requiring a database.
Run with: pytest backend/tests/test_dataset_upload.py
"""

import pytest
import pandas as pd
import io

from app.utils.schema_inference import (
    infer_field_type,
    get_select_values,
    infer_schema_from_dataframe,
    pandas_dtype_to_sql,
    generate_create_table_sql,
    OPERATORS_BY_TYPE,
    SELECT_UNIQUE_THRESHOLD,
)
from app.services.dataset_service import sanitize_table_name


class TestFieldTypeInference:
    """Tests for field type inference from pandas dtypes."""

    def test_infer_boolean_field(self):
        """Boolean columns should be inferred as boolean type."""
        series = pd.Series([True, False, True, False])
        assert infer_field_type(series) == "boolean"

    def test_infer_integer_field(self):
        """Integer columns should be inferred as number type."""
        series = pd.Series([1, 2, 3, 4, 5])
        assert infer_field_type(series) == "number"

    def test_infer_float_field(self):
        """Float columns should be inferred as number type."""
        series = pd.Series([1.5, 2.5, 3.5])
        assert infer_field_type(series) == "number"

    def test_infer_datetime_field(self):
        """Datetime columns should be inferred as datetime type."""
        series = pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"])
        assert infer_field_type(series) == "datetime"

    def test_infer_select_field_low_cardinality(self):
        """String columns with few unique values should be select type."""
        series = pd.Series(["A", "B", "C", "A", "B", "C"])
        assert infer_field_type(series) == "select"

    def test_infer_text_field_high_cardinality(self):
        """String columns with many unique values should be text type."""
        # Create more than SELECT_UNIQUE_THRESHOLD unique values
        series = pd.Series([f"value_{i}" for i in range(SELECT_UNIQUE_THRESHOLD + 5)])
        assert infer_field_type(series) == "text"

    def test_infer_text_field_at_threshold(self):
        """String columns exactly at threshold should be select type."""
        series = pd.Series([f"v{i}" for i in range(SELECT_UNIQUE_THRESHOLD)])
        assert infer_field_type(series) == "select"


class TestSelectValues:
    """Tests for getting select field values."""

    def test_get_select_values_simple(self):
        """Should return sorted list of unique values."""
        series = pd.Series(["B", "A", "C", "B", "A"])
        values = get_select_values(series)

        assert len(values) == 3
        assert values[0] == {"value": "A", "title": "A"}
        assert values[1] == {"value": "B", "title": "B"}
        assert values[2] == {"value": "C", "title": "C"}

    def test_get_select_values_with_nulls(self):
        """Should exclude null values from list."""
        series = pd.Series(["A", None, "B", pd.NA, "C"])
        values = get_select_values(series)

        assert len(values) == 3
        assert all(v["value"] in ["A", "B", "C"] for v in values)


class TestSchemaInference:
    """Tests for full schema inference from DataFrame."""

    def test_infer_schema_basic(self):
        """Should infer correct types for mixed DataFrame."""
        df = pd.DataFrame({
            "id": [1, 2, 3],
            "name": ["Product A", "Product B", "Product C"],
            "category": ["Electronics", "Hardware", "Electronics"],
            "price": [99.99, 49.99, 149.99],
            "in_stock": [True, False, True],
        })

        schema = infer_schema_from_dataframe(df)

        assert "fields" in schema
        fields = schema["fields"]

        assert fields["id"]["type"] == "number"
        assert fields["name"]["type"] == "select"  # 3 unique values
        assert fields["category"]["type"] == "select"  # 2 unique values
        assert fields["price"]["type"] == "number"
        assert fields["in_stock"]["type"] == "boolean"

    def test_infer_schema_has_operators(self):
        """Each field should have appropriate operators."""
        df = pd.DataFrame({
            "amount": [100, 200, 300],
            "status": ["active", "pending", "active"],
        })

        schema = infer_schema_from_dataframe(df)
        fields = schema["fields"]

        # Number fields should have comparison operators
        assert "greater" in fields["amount"]["operators"]
        assert "between" in fields["amount"]["operators"]

        # Select fields should have select operators
        assert "select_equals" in fields["status"]["operators"]
        assert "select_any_in" in fields["status"]["operators"]

    def test_infer_schema_select_has_list_values(self):
        """Select fields should have listValues populated."""
        df = pd.DataFrame({
            "status": ["active", "pending", "completed", "active"],
        })

        schema = infer_schema_from_dataframe(df)
        fields = schema["fields"]

        assert "listValues" in fields["status"]
        list_values = fields["status"]["listValues"]
        assert len(list_values) == 3
        values = [v["value"] for v in list_values]
        assert "active" in values
        assert "pending" in values
        assert "completed" in values

    def test_infer_schema_nullable_detection(self):
        """Should detect nullable columns."""
        df = pd.DataFrame({
            "required": [1, 2, 3],
            "optional": [1, None, 3],
        })

        schema = infer_schema_from_dataframe(df)
        fields = schema["fields"]

        assert fields["required"]["nullable"] == False
        assert fields["optional"]["nullable"] == True


class TestPandasDtypeToSql:
    """Tests for pandas dtype to SQL conversion."""

    def test_boolean_to_sql(self):
        """Boolean should map to BOOLEAN."""
        assert pandas_dtype_to_sql(pd.Series([True]).dtype) == "BOOLEAN"

    def test_integer_to_sql(self):
        """Integer should map to BIGINT."""
        assert pandas_dtype_to_sql(pd.Series([1, 2, 3]).dtype) == "BIGINT"

    def test_float_to_sql(self):
        """Float should map to DOUBLE PRECISION."""
        assert pandas_dtype_to_sql(pd.Series([1.5, 2.5]).dtype) == "DOUBLE PRECISION"

    def test_datetime_to_sql(self):
        """Datetime should map to TIMESTAMP."""
        series = pd.to_datetime(["2024-01-01"])
        assert pandas_dtype_to_sql(series.dtype) == "TIMESTAMP"

    def test_string_to_sql(self):
        """String/object should map to TEXT."""
        assert pandas_dtype_to_sql(pd.Series(["a", "b"]).dtype) == "TEXT"


class TestGenerateCreateTableSql:
    """Tests for SQL table generation."""

    def test_generate_basic_table(self):
        """Should generate valid CREATE TABLE SQL."""
        df = pd.DataFrame({
            "name": ["A", "B"],
            "value": [1, 2],
        })

        sql = generate_create_table_sql("test_table", df)

        assert 'CREATE TABLE "test_table"' in sql
        assert '"name" TEXT' in sql
        assert '"value" BIGINT' in sql
        assert "_row_id SERIAL PRIMARY KEY" in sql

    def test_generate_table_with_primary_key(self):
        """Should use specified primary key column."""
        df = pd.DataFrame({
            "id": [1, 2],
            "name": ["A", "B"],
        })

        sql = generate_create_table_sql("test_table", df, primary_key_column="id")

        assert '"id" BIGINT PRIMARY KEY' in sql
        assert "_row_id" not in sql


class TestSanitizeTableName:
    """Tests for table name sanitization."""

    def test_sanitize_simple_name(self):
        """Simple names should be prefixed and get unique suffix."""
        name = sanitize_table_name("MyDataset")
        assert name.startswith("data_mydataset_")
        assert len(name) > len("data_mydataset_")

    def test_sanitize_with_spaces(self):
        """Spaces should be replaced with underscores."""
        name = sanitize_table_name("My Dataset Name")
        assert " " not in name
        assert "my_dataset_name" in name

    def test_sanitize_with_special_chars(self):
        """Special characters should be replaced."""
        name = sanitize_table_name("Data@2024!Test")
        assert "@" not in name
        assert "!" not in name

    def test_sanitize_starting_with_number(self):
        """Names starting with numbers should be prefixed."""
        name = sanitize_table_name("2024_data")
        assert name.startswith("data_t_")

    def test_sanitize_produces_unique_names(self):
        """Multiple calls should produce unique names."""
        name1 = sanitize_table_name("Test")
        name2 = sanitize_table_name("Test")
        assert name1 != name2


class TestOperatorsByType:
    """Tests for operator constants."""

    def test_number_operators_include_comparison(self):
        """Number operators should include comparison operators."""
        ops = OPERATORS_BY_TYPE["number"]
        assert "greater" in ops
        assert "less" in ops
        assert "between" in ops

    def test_text_operators_include_string_matching(self):
        """Text operators should include string matching."""
        ops = OPERATORS_BY_TYPE["text"]
        assert "like" in ops
        assert "starts_with" in ops
        assert "ends_with" in ops

    def test_boolean_operators_are_limited(self):
        """Boolean operators should only be equal/not_equal."""
        ops = OPERATORS_BY_TYPE["boolean"]
        assert ops == ["equal", "not_equal"]

    def test_select_operators_include_select_variants(self):
        """Select operators should use select_ prefixed operators."""
        ops = OPERATORS_BY_TYPE["select"]
        assert "select_equals" in ops
        assert "select_any_in" in ops
