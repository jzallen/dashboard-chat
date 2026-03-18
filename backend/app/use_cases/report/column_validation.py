"""Column metadata validation for reports.

Validates semantic_role/semantic_type pairs and time_granularity requirements
for report column metadata.
"""

from app.use_cases.exceptions import DomainException

VALID_TYPES_BY_ROLE = {
    "entity": {"primary", "foreign", "unique"},
    "dimension": {"categorical", "time"},
    "measure": {"sum", "count", "count_distinct", "avg", "min", "max"},
}

TIME_GRANULARITIES = {"day", "week", "month", "quarter", "year"}


class InvalidColumnMetadata(DomainException):
    """Raised when column metadata contains invalid semantic role/type pairs."""

    _type = "INVALID_COLUMN_METADATA"
    _title = "Invalid Column Metadata"
    _status_code = 400


def validate_columns_metadata(columns_metadata: list[dict]) -> None:
    """Validate semantic_role/semantic_type pairs and time_granularity requirement.

    Args:
        columns_metadata: List of column metadata dicts with at minimum
            'name', 'semantic_role', and 'semantic_type' keys.

    Raises:
        InvalidColumnMetadata: If any column has invalid role/type pair
            or missing time_granularity for time dimensions.
    """
    for col in columns_metadata:
        role = col.get("semantic_role")
        stype = col.get("semantic_type")
        valid_types = VALID_TYPES_BY_ROLE.get(role)
        if valid_types is None:
            raise InvalidColumnMetadata(f"Invalid semantic_role '{role}' for column '{col['name']}'")
        if stype not in valid_types:
            raise InvalidColumnMetadata(f"'{stype}' is not valid for {role} role on column '{col['name']}'")
        if stype == "time" and not col.get("time_granularity"):
            raise InvalidColumnMetadata(f"time_granularity is required for time dimension on column '{col['name']}'")
        if stype == "time" and col.get("time_granularity") not in TIME_GRANULARITIES:
            raise InvalidColumnMetadata(
                f"Invalid time_granularity '{col.get('time_granularity')}' on column '{col['name']}'"
            )
