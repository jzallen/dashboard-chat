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
