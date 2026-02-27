"""Column profiling utilities for dataset analysis.

Computes per-column statistics based on schema type for LLM context.
"""

import math
from typing import Any

import pandas as pd


def _finite_or_none(value: float) -> float | None:
    """Return None for NaN/Infinity, otherwise the value."""
    if math.isfinite(value):
        return value
    return None


def compute_column_profiles(
    df: pd.DataFrame,
    schema_config: dict,
    max_unique: int = 20,
) -> dict[str, Any]:
    """Compute per-column profiles based on schema field types.

    Args:
        df: The DataFrame to profile
        schema_config: Schema config with {"fields": {"col": {"type": "..."}}}
        max_unique: Maximum number of sample values for text columns

    Returns:
        Dict mapping column names to their profile dicts.
    """
    if df.empty:
        return {col: _empty_profile(info.get("type", "text")) for col, info in schema_config.get("fields", {}).items()}

    # Sample large DataFrames to keep profiling fast
    if len(df) > 100_000:
        df = df.head(100_000)

    profiles: dict[str, Any] = {}
    for col, info in schema_config.get("fields", {}).items():
        col_type = info.get("type", "text")
        if col not in df.columns:
            profiles[col] = _empty_profile(col_type)
            continue

        series = df[col]
        null_count = int(series.isna().sum())

        if col_type == "number":
            profiles[col] = _profile_number(series, null_count)
        elif col_type == "datetime":
            profiles[col] = _profile_datetime(series, null_count)
        elif col_type == "boolean":
            profiles[col] = _profile_boolean(series, null_count)
        else:
            profiles[col] = _profile_text(series, null_count, max_unique)

    return profiles


def _empty_profile(col_type: str) -> dict[str, Any]:
    """Return a sensible default profile for an empty or all-null column."""
    if col_type == "number":
        return {"type": "number", "min": None, "max": None, "mean": None, "null_count": 0}
    if col_type == "datetime":
        return {"type": "datetime", "min": None, "max": None, "null_count": 0}
    if col_type == "boolean":
        return {"type": "boolean", "true_count": 0, "false_count": 0, "null_count": 0}
    return {"type": "text", "sample_values": [], "unique_count": 0, "null_count": 0}


def _profile_text(series: pd.Series, null_count: int, max_unique: int) -> dict[str, Any]:
    """Profile a text column."""
    non_null = series.dropna()
    if non_null.empty:
        return {"type": "text", "sample_values": [], "unique_count": 0, "null_count": null_count}

    unique_count = int(non_null.nunique())

    # Top values by frequency (desc), then alphabetical (asc) for tiebreak
    counts = non_null.value_counts()
    # Sort by count desc, then value asc
    sorted_values = sorted(
        counts.items(),
        key=lambda item: (-item[1], str(item[0])),
    )
    sample_values = [str(val) for val, _ in sorted_values[:max_unique]]

    return {
        "type": "text",
        "sample_values": sample_values,
        "unique_count": unique_count,
        "null_count": null_count,
    }


def _profile_number(series: pd.Series, null_count: int) -> dict[str, Any]:
    """Profile a number column."""
    non_null = series.dropna()
    if non_null.empty:
        return {"type": "number", "min": None, "max": None, "mean": None, "null_count": null_count}

    return {
        "type": "number",
        "min": _finite_or_none(float(non_null.min())),
        "max": _finite_or_none(float(non_null.max())),
        "mean": _finite_or_none(float(non_null.mean())),
        "null_count": null_count,
    }


def _profile_datetime(series: pd.Series, null_count: int) -> dict[str, Any]:
    """Profile a datetime column."""
    non_null = series.dropna()
    if non_null.empty:
        return {"type": "datetime", "min": None, "max": None, "null_count": null_count}

    # Ensure we have datetime objects
    if not pd.api.types.is_datetime64_any_dtype(non_null):
        non_null = pd.to_datetime(non_null, errors="coerce").dropna()
        if non_null.empty:
            return {"type": "datetime", "min": None, "max": None, "null_count": null_count}

    return {
        "type": "datetime",
        "min": str(non_null.min().isoformat()),
        "max": str(non_null.max().isoformat()),
        "null_count": null_count,
    }


def _profile_boolean(series: pd.Series, null_count: int) -> dict[str, Any]:
    """Profile a boolean column."""
    non_null = series.dropna()
    if non_null.empty:
        return {"type": "boolean", "true_count": 0, "false_count": 0, "null_count": null_count}

    true_count = int(non_null.sum())
    false_count = int(len(non_null) - true_count)

    return {
        "type": "boolean",
        "true_count": true_count,
        "false_count": false_count,
        "null_count": null_count,
    }
