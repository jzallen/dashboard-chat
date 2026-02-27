"""Unit tests for CleaningExpression — expression_config → Ibis expression conversion."""

import ibis
import pytest

from app.types import CleaningExpression

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def text_table():
    """Create a simple Ibis table with a text column."""
    return ibis.table({"name": "string", "city": "string", "status": "string"}, name="t")


@pytest.fixture
def mixed_table():
    """Create an Ibis table with mixed column types."""
    return ibis.table(
        {"name": "string", "age": "int64", "salary": "float64", "active": "boolean"},
        name="t",
    )


# ============================================================================
# Validation tests
# ============================================================================


class TestCleaningExpressionValidation:
    def test_empty_config_raises(self):
        with pytest.raises(ValueError, match="must not be empty"):
            CleaningExpression({})

    def test_missing_operation_raises(self):
        with pytest.raises(ValueError, match="'operation' field"):
            CleaningExpression({"column": "name"})

    def test_unsupported_operation_raises(self):
        with pytest.raises(ValueError, match="Unsupported operation 'reverse'"):
            CleaningExpression({"operation": "reverse"})

    def test_case_missing_mode_raises(self):
        with pytest.raises(ValueError, match="'mode' field is required"):
            CleaningExpression({"operation": "case"})

    def test_case_invalid_mode_raises(self):
        with pytest.raises(ValueError, match="Invalid case mode 'reverse'"):
            CleaningExpression({"operation": "case", "mode": "reverse"})

    def test_fill_null_missing_fill_value_raises(self):
        with pytest.raises(ValueError, match="'fill_value' field is required"):
            CleaningExpression({"operation": "fill_null"})

    def test_map_values_missing_mappings_raises(self):
        with pytest.raises(ValueError, match="'mappings' field is required"):
            CleaningExpression({"operation": "map_values"})

    def test_alias_missing_alias_raises(self):
        with pytest.raises(ValueError, match="'alias' field is required"):
            CleaningExpression({"operation": "alias"})


# ============================================================================
# Trim operation
# ============================================================================


class TestTrimExpression:
    def test_trim_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "trim"})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_trim_display_sql(self):
        expr = CleaningExpression({"operation": "trim"})
        assert expr.to_display_sql("name") == "TRIM(name)"


# ============================================================================
# Case operations
# ============================================================================


class TestCaseExpression:
    def test_upper_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "case", "mode": "upper"})
        result = expr.as_ibis_expr(text_table, "status")
        assert result is not None

    def test_upper_display_sql(self):
        expr = CleaningExpression({"operation": "case", "mode": "upper"})
        assert expr.to_display_sql("status") == "UPPER(status)"

    def test_lower_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "case", "mode": "lower"})
        result = expr.as_ibis_expr(text_table, "status")
        assert result is not None

    def test_lower_display_sql(self):
        expr = CleaningExpression({"operation": "case", "mode": "lower"})
        assert expr.to_display_sql("status") == "LOWER(status)"

    def test_title_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "case", "mode": "title"})
        result = expr.as_ibis_expr(text_table, "city")
        assert result is not None

    def test_title_display_sql(self):
        expr = CleaningExpression({"operation": "case", "mode": "title"})
        assert expr.to_display_sql("city") == "title_case(city)"

    def test_snake_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "case", "mode": "snake"})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_snake_display_sql(self):
        expr = CleaningExpression({"operation": "case", "mode": "snake"})
        assert expr.to_display_sql("name") == "snake_case(name)"

    def test_kebab_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "case", "mode": "kebab"})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_kebab_display_sql(self):
        expr = CleaningExpression({"operation": "case", "mode": "kebab"})
        assert expr.to_display_sql("name") == "kebab_case(name)"

    def test_snake_mode_accepted_by_validation(self):
        expr = CleaningExpression({"operation": "case", "mode": "snake"})
        assert expr.operation == "case"

    def test_kebab_mode_accepted_by_validation(self):
        expr = CleaningExpression({"operation": "case", "mode": "kebab"})
        assert expr.operation == "case"

    def test_invalid_mode_error_lists_all_five_modes(self):
        with pytest.raises(ValueError, match="upper, lower, title, snake, kebab"):
            CleaningExpression({"operation": "case", "mode": "camel"})


# ============================================================================
# Fill null operation
# ============================================================================


class TestFillNullExpression:
    def test_fill_null_string_creates_valid_expression(self, text_table):
        expr = CleaningExpression({"operation": "fill_null", "fill_value": "Unknown"})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_fill_null_string_display_sql(self):
        expr = CleaningExpression({"operation": "fill_null", "fill_value": "Unknown"})
        assert expr.to_display_sql("department") == "COALESCE(department, 'Unknown')"

    def test_fill_null_numeric_creates_valid_expression(self, mixed_table):
        expr = CleaningExpression({"operation": "fill_null", "fill_value": 0})
        result = expr.as_ibis_expr(mixed_table, "salary")
        assert result is not None

    def test_fill_null_numeric_display_sql(self):
        expr = CleaningExpression({"operation": "fill_null", "fill_value": 0})
        assert expr.to_display_sql("salary") == "COALESCE(salary, 0)"

    def test_fill_null_sql_injection_safe(self):
        """Fill value with SQL-special characters is safely escaped in display SQL."""
        expr = CleaningExpression({"operation": "fill_null", "fill_value": "O'Brien; DROP TABLE"})
        sql = expr.to_display_sql("name")
        assert sql == "COALESCE(name, 'O''Brien; DROP TABLE')"

    def test_fill_null_ibis_treats_as_literal(self, text_table):
        """Ibis treats fill_value as a literal, not a SQL fragment."""
        expr = CleaningExpression({"operation": "fill_null", "fill_value": "O'Brien; DROP TABLE"})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None


# ============================================================================
# Map values operation
# ============================================================================


class TestMapValuesExpression:
    def test_single_mapping(self, text_table):
        expr = CleaningExpression(
            {
                "operation": "map_values",
                "mappings": [{"from": "NY", "to": "New York"}],
            }
        )
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_single_mapping_display_sql(self):
        expr = CleaningExpression(
            {
                "operation": "map_values",
                "mappings": [{"from": "NY", "to": "New York"}],
            }
        )
        sql = expr.to_display_sql("state")
        assert "CASE" in sql
        assert "WHEN state = 'NY' THEN 'New York'" in sql
        assert "ELSE state END" in sql

    def test_multiple_mappings(self, text_table):
        expr = CleaningExpression(
            {
                "operation": "map_values",
                "mappings": [
                    {"from": "NY", "to": "New York"},
                    {"from": "CA", "to": "California"},
                ],
            }
        )
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_multiple_mappings_display_sql(self):
        expr = CleaningExpression(
            {
                "operation": "map_values",
                "mappings": [
                    {"from": "NY", "to": "New York"},
                    {"from": "CA", "to": "California"},
                ],
            }
        )
        sql = expr.to_display_sql("state")
        assert "WHEN state = 'NY' THEN 'New York'" in sql
        assert "WHEN state = 'CA' THEN 'California'" in sql
        assert "ELSE state END" in sql

    def test_empty_mappings_returns_column(self, text_table):
        expr = CleaningExpression({"operation": "map_values", "mappings": []})
        result = expr.as_ibis_expr(text_table, "name")
        assert result is not None

    def test_empty_mappings_display_sql_returns_column(self):
        expr = CleaningExpression({"operation": "map_values", "mappings": []})
        assert expr.to_display_sql("state") == "state"


# ============================================================================
# Alias operation
# ============================================================================


class TestAliasExpression:
    def test_alias_name_property(self):
        expr = CleaningExpression({"operation": "alias", "alias": "Employee ID"})
        assert expr.alias_name == "Employee ID"

    def test_alias_display_sql(self):
        expr = CleaningExpression({"operation": "alias", "alias": "Employee ID"})
        assert expr.to_display_sql("emp_id") == 'emp_id AS "Employee ID"'

    def test_alias_as_ibis_expr_raises(self, text_table):
        """Alias transforms should not be used in as_ibis_expr (they go through RENAME stage)."""
        expr = CleaningExpression({"operation": "alias", "alias": "Full Name"})
        with pytest.raises(ValueError, match="RENAME stage"):
            expr.as_ibis_expr(text_table, "name")

    def test_non_alias_has_no_alias_name(self):
        expr = CleaningExpression({"operation": "trim"})
        assert expr.alias_name is None


# ============================================================================
# Operation property
# ============================================================================


class TestOperationProperty:
    def test_operation_property(self):
        assert CleaningExpression({"operation": "trim"}).operation == "trim"
        assert CleaningExpression({"operation": "case", "mode": "upper"}).operation == "case"
        assert CleaningExpression({"operation": "fill_null", "fill_value": "X"}).operation == "fill_null"
        assert CleaningExpression({"operation": "map_values", "mappings": []}).operation == "map_values"
        assert CleaningExpression({"operation": "alias", "alias": "X"}).operation == "alias"
