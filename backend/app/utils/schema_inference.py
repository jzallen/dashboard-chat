"""Schema inference utilities for CSV data.

Converts pandas dtypes to RAQB field configurations for query building.
"""

from typing import Any

import pandas as pd


# RAQB operators by field type
OPERATORS_BY_TYPE = {
    "number": [
        "equal",
        "not_equal",
        "less",
        "less_or_equal",
        "greater",
        "greater_or_equal",
        "between",
        "not_between",
        "is_null",
        "is_not_null",
    ],
    "text": [
        "equal",
        "not_equal",
        "like",
        "not_like",
        "starts_with",
        "ends_with",
        "is_empty",
        "is_not_empty",
    ],
    "boolean": ["equal", "not_equal"],
    "datetime": [
        "equal",
        "not_equal",
        "less",
        "less_or_equal",
        "greater",
        "greater_or_equal",
        "between",
        "not_between",
        "is_null",
        "is_not_null",
    ],
    "select": [
        "select_equals",
        "select_not_equals",
        "select_any_in",
        "select_not_any_in",
    ],
}

# Threshold for converting text to select type
SELECT_UNIQUE_THRESHOLD = 20


def infer_field_type(series: pd.Series) -> str:
    """Infer RAQB field type from pandas Series.

    Args:
        series: A pandas Series column

    Returns:
        RAQB field type: "text", "number", "boolean", "datetime", or "select"
    """
    dtype = series.dtype

    # Boolean
    if pd.api.types.is_bool_dtype(dtype):
        return "boolean"

    # Numeric
    if pd.api.types.is_numeric_dtype(dtype):
        return "number"

    # Datetime
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "datetime"

    # Object (string) - check if it should be select or text
    if pd.api.types.is_object_dtype(dtype) or pd.api.types.is_string_dtype(dtype):
        # Count unique non-null values
        unique_count = series.dropna().nunique()
        if unique_count <= SELECT_UNIQUE_THRESHOLD:
            return "select"
        return "text"

    # Default to text
    return "text"


def get_select_values(series: pd.Series) -> list[dict[str, str]]:
    """Get list values for a select field.

    Args:
        series: A pandas Series with categorical-like values

    Returns:
        List of {value, title} dicts for RAQB select field
    """
    unique_values = series.dropna().unique()
    return [{"value": str(v), "title": str(v)} for v in sorted(unique_values)]


def infer_schema_from_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Infer RAQB schema configuration from a pandas DataFrame.

    Args:
        df: The DataFrame to analyze

    Returns:
        RAQB schema config dict with fields configuration
    """
    fields = {}

    for column in df.columns:
        series = df[column]
        field_type = infer_field_type(series)

        field_config: dict[str, Any] = {
            "label": column,
            "type": field_type,
            "operators": OPERATORS_BY_TYPE.get(field_type, OPERATORS_BY_TYPE["text"]),
            "nullable": series.isnull().any(),
        }

        # Add list values for select fields
        if field_type == "select":
            field_config["listValues"] = get_select_values(series)

        fields[column] = field_config

    return {"fields": fields}


def pandas_dtype_to_sql(dtype) -> str:
    """Convert pandas dtype to PostgreSQL column type.

    Args:
        dtype: pandas dtype

    Returns:
        PostgreSQL column type string
    """
    if pd.api.types.is_bool_dtype(dtype):
        return "BOOLEAN"
    if pd.api.types.is_integer_dtype(dtype):
        return "BIGINT"
    if pd.api.types.is_float_dtype(dtype):
        return "DOUBLE PRECISION"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "TIMESTAMP"
    # Default to TEXT for everything else
    return "TEXT"


def generate_create_table_sql(
    table_name: str,
    df: pd.DataFrame,
    primary_key_column: str | None = None,
) -> str:
    """Generate CREATE TABLE SQL for a DataFrame.

    Args:
        table_name: Name for the new table
        df: DataFrame to create table for
        primary_key_column: Optional column to use as primary key

    Returns:
        SQL CREATE TABLE statement
    """
    columns = []

    # Add auto-generated row ID if no primary key specified
    if primary_key_column is None:
        columns.append("_row_id SERIAL PRIMARY KEY")

    for col_name in df.columns:
        dtype = df[col_name].dtype
        sql_type = pandas_dtype_to_sql(dtype)

        # Sanitize column name (remove special characters, wrap in quotes)
        safe_col = f'"{col_name}"'

        if col_name == primary_key_column:
            columns.append(f"{safe_col} {sql_type} PRIMARY KEY")
        else:
            columns.append(f"{safe_col} {sql_type}")

    columns_sql = ",\n  ".join(columns)
    return f'CREATE TABLE "{table_name}" (\n  {columns_sql}\n);'
