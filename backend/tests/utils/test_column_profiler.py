"""Tests for column profiler utility."""

import json

import numpy as np
import pandas as pd
import pytest

from app.utils.column_profiler import compute_column_profiles

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def text_df():
    return pd.DataFrame(
        {
            "city": ["NYC", "LA", "NYC", "NYC", "LA", "Chicago", None],
        }
    )


@pytest.fixture
def number_df():
    return pd.DataFrame(
        {
            "price": [10.5, 20.0, 30.5, None, 50.0],
        }
    )


@pytest.fixture
def datetime_df():
    return pd.DataFrame(
        {
            "created": pd.to_datetime(["2024-01-01", "2024-06-15", "2024-12-31", None]),
        }
    )


@pytest.fixture
def boolean_df():
    return pd.DataFrame(
        {
            "active": [True, False, True, True, None],
        }
    )


@pytest.fixture
def mixed_df():
    return pd.DataFrame(
        {
            "name": ["Alice", "Bob", "Alice", None],
            "age": [30, 25, 30, None],
            "joined": pd.to_datetime(["2024-01-01", "2024-06-01", None, None]),
            "verified": [True, False, True, None],
        }
    )


@pytest.fixture
def mixed_schema():
    return {
        "fields": {
            "name": {"type": "text"},
            "age": {"type": "number"},
            "joined": {"type": "datetime"},
            "verified": {"type": "boolean"},
        }
    }


# ---------------------------------------------------------------------------
# Text column tests
# ---------------------------------------------------------------------------


class TestTextProfile:
    def test_basic_text(self, text_df):
        schema = {"fields": {"city": {"type": "text"}}}
        result = compute_column_profiles(text_df, schema)

        assert result["city"]["type"] == "text"
        assert result["city"]["null_count"] == 1
        assert result["city"]["unique_count"] == 3
        # NYC appears 3x, LA 2x, Chicago 1x
        assert result["city"]["sample_values"][0] == "NYC"
        assert result["city"]["sample_values"][1] == "LA"
        assert result["city"]["sample_values"][2] == "Chicago"

    def test_max_unique_limit(self):
        df = pd.DataFrame({"col": [f"val_{i}" for i in range(50)]})
        schema = {"fields": {"col": {"type": "text"}}}
        result = compute_column_profiles(df, schema, max_unique=5)

        assert len(result["col"]["sample_values"]) == 5

    def test_alpha_tiebreak(self):
        """When counts are tied, values should be sorted alphabetically."""
        df = pd.DataFrame({"col": ["banana", "apple", "cherry"]})
        schema = {"fields": {"col": {"type": "text"}}}
        result = compute_column_profiles(df, schema)

        # All have count=1, so alphabetical order
        assert result["col"]["sample_values"] == ["apple", "banana", "cherry"]


# ---------------------------------------------------------------------------
# Number column tests
# ---------------------------------------------------------------------------


class TestNumberProfile:
    def test_basic_number(self, number_df):
        schema = {"fields": {"price": {"type": "number"}}}
        result = compute_column_profiles(number_df, schema)

        assert result["price"]["type"] == "number"
        assert result["price"]["min"] == 10.5
        assert result["price"]["max"] == 50.0
        assert result["price"]["null_count"] == 1
        assert isinstance(result["price"]["mean"], float)

    def test_integer_column(self):
        df = pd.DataFrame({"count": [1, 2, 3, 4, 5]})
        schema = {"fields": {"count": {"type": "number"}}}
        result = compute_column_profiles(df, schema)

        assert result["count"]["min"] == 1.0
        assert result["count"]["max"] == 5.0
        assert result["count"]["mean"] == 3.0


# ---------------------------------------------------------------------------
# Datetime column tests
# ---------------------------------------------------------------------------


class TestDatetimeProfile:
    def test_basic_datetime(self, datetime_df):
        schema = {"fields": {"created": {"type": "datetime"}}}
        result = compute_column_profiles(datetime_df, schema)

        assert result["created"]["type"] == "datetime"
        assert "2024-01-01" in result["created"]["min"]
        assert "2024-12-31" in result["created"]["max"]
        assert result["created"]["null_count"] == 1


# ---------------------------------------------------------------------------
# Boolean column tests
# ---------------------------------------------------------------------------


class TestBooleanProfile:
    def test_basic_boolean(self, boolean_df):
        schema = {"fields": {"active": {"type": "boolean"}}}
        result = compute_column_profiles(boolean_df, schema)

        assert result["active"]["type"] == "boolean"
        assert result["active"]["true_count"] == 3
        assert result["active"]["false_count"] == 1
        assert result["active"]["null_count"] == 1


# ---------------------------------------------------------------------------
# Edge case tests
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_dataframe(self):
        df = pd.DataFrame({"a": pd.Series(dtype="object"), "b": pd.Series(dtype="float64")})
        schema = {"fields": {"a": {"type": "text"}, "b": {"type": "number"}}}
        result = compute_column_profiles(df, schema)

        assert result["a"]["type"] == "text"
        assert result["a"]["sample_values"] == []
        assert result["a"]["unique_count"] == 0
        assert result["b"]["type"] == "number"
        assert result["b"]["min"] is None

    def test_all_null_columns(self):
        df = pd.DataFrame(
            {
                "t": [None, None],
                "n": [None, None],
                "d": pd.Series([pd.NaT, pd.NaT]),
                "b": pd.Series([None, None], dtype="object"),
            }
        )
        schema = {
            "fields": {
                "t": {"type": "text"},
                "n": {"type": "number"},
                "d": {"type": "datetime"},
                "b": {"type": "boolean"},
            }
        }
        result = compute_column_profiles(df, schema)

        assert result["t"]["sample_values"] == []
        assert result["t"]["null_count"] == 2
        assert result["n"]["min"] is None
        assert result["n"]["null_count"] == 2
        assert result["d"]["min"] is None
        assert result["d"]["null_count"] == 2
        assert result["b"]["true_count"] == 0
        assert result["b"]["false_count"] == 0

    def test_column_missing_from_dataframe(self):
        """Schema references a column that doesn't exist in the DataFrame."""
        df = pd.DataFrame({"a": [1, 2]})
        schema = {"fields": {"missing_col": {"type": "text"}}}
        result = compute_column_profiles(df, schema)

        assert result["missing_col"]["type"] == "text"
        assert result["missing_col"]["sample_values"] == []

    def test_json_serializability(self, mixed_df, mixed_schema):
        result = compute_column_profiles(mixed_df, mixed_schema)
        # Should not raise
        serialized = json.dumps(result)
        assert isinstance(serialized, str)
        # Round-trip check
        parsed = json.loads(serialized)
        assert parsed == result

    def test_large_dataframe_sampling(self):
        """Verify profiling works on DataFrames larger than 100k rows."""
        rng = np.random.default_rng(seed=42)
        n = 200_000
        df = pd.DataFrame(
            {
                "val": rng.choice(["a", "b", "c"], size=n),
                "num": rng.standard_normal(n),
            }
        )
        schema = {
            "fields": {
                "val": {"type": "text"},
                "num": {"type": "number"},
            }
        }
        # Should not crash or take too long
        result = compute_column_profiles(df, schema)
        assert result["val"]["type"] == "text"
        assert result["num"]["type"] == "number"
        assert len(result["val"]["sample_values"]) <= 20


# ---------------------------------------------------------------------------
# Mixed column test
# ---------------------------------------------------------------------------


class TestMixedProfile:
    def test_all_types_together(self, mixed_df, mixed_schema):
        result = compute_column_profiles(mixed_df, mixed_schema)

        assert set(result.keys()) == {"name", "age", "joined", "verified"}
        assert result["name"]["type"] == "text"
        assert result["age"]["type"] == "number"
        assert result["joined"]["type"] == "datetime"
        assert result["verified"]["type"] == "boolean"
