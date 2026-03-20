"""Tests for grain role auto-assignment."""

from app.models.view import DisplayType, GrainRole, ViewColumn, ViewGrain
from app.use_cases.view.grain_service import assign_grain_roles


def _col(name: str, display_type: str, alias: str | None = None) -> ViewColumn:
    return ViewColumn(
        name=name,
        source_ref="ds1",
        source_column=name,
        display_type=DisplayType(display_type),
        alias=alias,
    )


class TestAssignGrainRoles:
    def test_no_grain_clears_all_roles(self):
        columns = [_col("order_date", "date"), _col("amount", "decimal")]
        result = assign_grain_roles(columns, None)
        assert all(c.grain_role is None for c in result)

    def test_time_column_gets_time_role(self):
        grain = ViewGrain(time_column="order_date", dimensions=[])
        columns = [_col("order_date", "date"), _col("amount", "decimal")]
        result = assign_grain_roles(columns, grain)
        assert result[0].grain_role == GrainRole.Time

    def test_time_column_wrong_type_gets_none(self):
        grain = ViewGrain(time_column="order_date", dimensions=[])
        columns = [_col("order_date", "text")]
        result = assign_grain_roles(columns, grain)
        assert result[0].grain_role is None

    def test_dimension_with_text_type(self):
        grain = ViewGrain(time_column="order_date", dimensions=["region"])
        columns = [_col("order_date", "date"), _col("region", "text")]
        result = assign_grain_roles(columns, grain)
        assert result[1].grain_role == GrainRole.Dimension

    def test_dimension_with_category_type(self):
        grain = ViewGrain(time_column="order_date", dimensions=["status"])
        columns = [_col("order_date", "date"), _col("status", "category")]
        result = assign_grain_roles(columns, grain)
        assert result[1].grain_role == GrainRole.Dimension

    def test_dimension_with_serial_type(self):
        grain = ViewGrain(time_column="order_date", dimensions=["batch"])
        columns = [_col("order_date", "date"), _col("batch", "serial")]
        result = assign_grain_roles(columns, grain)
        assert result[1].grain_role == GrainRole.Dimension

    def test_entity_with_id_type(self):
        grain = ViewGrain(time_column="order_date", dimensions=["customer_id"])
        columns = [_col("order_date", "date"), _col("customer_id", "id")]
        result = assign_grain_roles(columns, grain)
        assert result[1].grain_role == GrainRole.Entity

    def test_metric_auto_assigned_for_numeric(self):
        grain = ViewGrain(time_column="order_date", dimensions=["region"])
        columns = [
            _col("order_date", "date"),
            _col("region", "text"),
            _col("amount", "decimal"),
            _col("count", "integer"),
        ]
        result = assign_grain_roles(columns, grain)
        assert result[2].grain_role == GrainRole.Metric
        assert result[3].grain_role == GrainRole.Metric

    def test_numeric_in_dimensions_not_metric(self):
        grain = ViewGrain(time_column="order_date", dimensions=["quantity"])
        columns = [_col("order_date", "date"), _col("quantity", "integer")]
        result = assign_grain_roles(columns, grain)
        # integer in dimensions with integer type -> None (not text/category/serial/id)
        assert result[1].grain_role is None

    def test_boolean_column_gets_none(self):
        grain = ViewGrain(time_column="order_date", dimensions=[])
        columns = [_col("order_date", "date"), _col("is_active", "boolean")]
        result = assign_grain_roles(columns, grain)
        assert result[1].grain_role is None

    def test_alias_used_as_output_name(self):
        grain = ViewGrain(time_column="event_date", dimensions=[])
        columns = [
            ViewColumn(
                name="event_date",
                source_ref="ds1",
                source_column="created_at",
                display_type=DisplayType.date,
                alias="event_date",
            )
        ]
        result = assign_grain_roles(columns, grain)
        assert result[0].grain_role == GrainRole.Time

    def test_full_scenario(self):
        grain = ViewGrain(time_column="order_date", dimensions=["region", "customer_id"])
        columns = [
            _col("order_date", "date"),
            _col("region", "category"),
            _col("customer_id", "id"),
            _col("revenue", "decimal"),
            _col("units", "integer"),
            _col("is_refund", "boolean"),
            _col("notes", "text"),
        ]
        result = assign_grain_roles(columns, grain)
        assert result[0].grain_role == GrainRole.Time
        assert result[1].grain_role == GrainRole.Dimension
        assert result[2].grain_role == GrainRole.Entity
        assert result[3].grain_role == GrainRole.Metric
        assert result[4].grain_role == GrainRole.Metric
        assert result[5].grain_role is None
        assert result[6].grain_role is None  # text not in dimensions
