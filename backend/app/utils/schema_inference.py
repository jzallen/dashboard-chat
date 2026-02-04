"""Schema inference utilities for CSV data.

Infers field types from pandas DataFrames for table rendering.
"""

from typing import Any

import pandas as pd


def _infer_field_type(dtype) -> str:
    """Map a pandas dtype to a schema field type."""
    if pd.api.types.is_bool_dtype(dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(dtype):
        return "number"
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return "datetime"
    return "text"


def infer_schema_from_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Infer schema configuration from a pandas DataFrame.

    Args:
        df: The DataFrame to analyze

    Returns:
        Schema config: {"fields": {"col_name": {"type": "text|number|boolean|datetime"}, ...}}
    """
    return {
        "fields": {
            column: {"type": _infer_field_type(df[column].dtype)}
            for column in df.columns
        }
    }


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
