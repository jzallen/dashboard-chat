"""Tests for report column metadata validation."""

import pytest

from app.use_cases.report.column_validation import InvalidColumnMetadata, validate_columns_metadata


class TestValidateColumnsMetadata:
    """Tests for validate_columns_metadata."""

    def test_valid_entity_primary(self):
        """Entity with primary type should pass."""
        validate_columns_metadata([{"name": "id", "semantic_role": "entity", "semantic_type": "primary"}])

    def test_valid_entity_foreign(self):
        """Entity with foreign type should pass."""
        validate_columns_metadata([{"name": "user_id", "semantic_role": "entity", "semantic_type": "foreign"}])

    def test_valid_entity_unique(self):
        """Entity with unique type should pass."""
        validate_columns_metadata([{"name": "email", "semantic_role": "entity", "semantic_type": "unique"}])

    def test_valid_dimension_categorical(self):
        """Dimension with categorical type should pass."""
        validate_columns_metadata([{"name": "region", "semantic_role": "dimension", "semantic_type": "categorical"}])

    def test_valid_dimension_time(self):
        """Dimension with time type and granularity should pass."""
        validate_columns_metadata([
            {"name": "order_date", "semantic_role": "dimension", "semantic_type": "time", "time_granularity": "day"}
        ])

    def test_valid_measure_sum(self):
        """Measure with sum type should pass."""
        validate_columns_metadata([{"name": "revenue", "semantic_role": "measure", "semantic_type": "sum"}])

    def test_valid_measure_count(self):
        """Measure with count type should pass."""
        validate_columns_metadata([{"name": "total", "semantic_role": "measure", "semantic_type": "count"}])

    def test_valid_measure_count_distinct(self):
        """Measure with count_distinct type should pass."""
        validate_columns_metadata([{"name": "users", "semantic_role": "measure", "semantic_type": "count_distinct"}])

    def test_valid_measure_avg(self):
        """Measure with avg type should pass."""
        validate_columns_metadata([{"name": "avg_price", "semantic_role": "measure", "semantic_type": "avg"}])

    def test_valid_measure_min_max(self):
        """Measure with min/max types should pass."""
        validate_columns_metadata([
            {"name": "min_price", "semantic_role": "measure", "semantic_type": "min"},
            {"name": "max_price", "semantic_role": "measure", "semantic_type": "max"},
        ])

    def test_invalid_role_raises(self):
        """Invalid semantic_role should raise InvalidColumnMetadata."""
        with pytest.raises(InvalidColumnMetadata, match="Invalid semantic_role 'unknown'"):
            validate_columns_metadata([{"name": "col", "semantic_role": "unknown", "semantic_type": "sum"}])

    def test_invalid_type_for_role_raises(self):
        """Invalid semantic_type for a given role should raise."""
        with pytest.raises(InvalidColumnMetadata, match="'sum' is not valid for entity role"):
            validate_columns_metadata([{"name": "id", "semantic_role": "entity", "semantic_type": "sum"}])

    def test_missing_time_granularity_raises(self):
        """Time dimension without time_granularity should raise."""
        with pytest.raises(InvalidColumnMetadata, match="time_granularity is required"):
            validate_columns_metadata([
                {"name": "order_date", "semantic_role": "dimension", "semantic_type": "time"}
            ])

    def test_invalid_time_granularity_raises(self):
        """Time dimension with invalid time_granularity should raise."""
        with pytest.raises(InvalidColumnMetadata, match="Invalid time_granularity 'hour'"):
            validate_columns_metadata([
                {"name": "order_date", "semantic_role": "dimension", "semantic_type": "time", "time_granularity": "hour"}
            ])

    def test_empty_metadata_passes(self):
        """Empty columns_metadata list should pass without error."""
        validate_columns_metadata([])

    def test_column_with_extra_fields_passes(self):
        """Column with extra fields like expr and description should pass."""
        validate_columns_metadata([
            {
                "name": "revenue",
                "semantic_role": "measure",
                "semantic_type": "sum",
                "expr": "price * quantity",
                "description": "Total revenue",
            }
        ])

    def test_valid_time_granularities(self):
        """All valid time granularities should pass."""
        for granularity in ("day", "week", "month", "quarter", "year"):
            validate_columns_metadata([
                {"name": "dt", "semantic_role": "dimension", "semantic_type": "time", "time_granularity": granularity}
            ])
