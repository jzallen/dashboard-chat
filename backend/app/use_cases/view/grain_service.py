"""Grain role auto-assignment logic for view columns."""

from __future__ import annotations

from app.models.view import DisplayType, GrainRole, ViewColumn, ViewGrain


def assign_grain_roles(
    columns: list[ViewColumn],
    grain: ViewGrain | None,
) -> list[ViewColumn]:
    """Re-derive grain_role for all columns based on the grain definition.

    Rules:
    - If grain is None: all grain_role = None
    - If grain is defined:
      - Column whose name == grain.time_column AND display_type in (date, time, datetime) -> Time
      - Column in grain.dimensions AND display_type in (text, category, serial) -> Dimension
      - Column in grain.dimensions AND display_type == id -> Entity
      - Column with display_type in (decimal, integer) AND NOT time column AND NOT in dimensions -> Metric
      - All others -> None
    """
    if grain is None:
        return [c.model_copy(update={"grain_role": None}) for c in columns]

    time_types = {DisplayType.date, DisplayType.time, DisplayType.datetime}
    dimension_types = {DisplayType.text, DisplayType.category, DisplayType.serial}
    metric_types = {DisplayType.decimal, DisplayType.integer}
    dimensions_set = set(grain.dimensions)

    result = []
    for col in columns:
        output_name = col.alias if col.alias else col.source_column
        role: GrainRole | None = None

        if output_name == grain.time_column and col.display_type in time_types:
            role = GrainRole.Time
        elif output_name in dimensions_set and col.display_type in dimension_types:
            role = GrainRole.Dimension
        elif output_name in dimensions_set and col.display_type == DisplayType.id:
            role = GrainRole.Entity
        elif (
            col.display_type in metric_types and output_name != grain.time_column and output_name not in dimensions_set
        ):
            role = GrainRole.Metric

        result.append(col.model_copy(update={"grain_role": role}))
    return result
