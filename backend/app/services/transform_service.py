"""Transform service for transform management."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Transform


def raqb_to_sql(raqb_tree: dict, identifier_quote: str = '"') -> str:
    """Convert RAQB JSON tree to SQL WHERE clause.

    This is a Python implementation matching the TypeScript version.

    Args:
        raqb_tree: RAQB JSON tree format filter
        identifier_quote: Quote character for identifiers

    Returns:
        SQL WHERE clause (without "WHERE" keyword)
    """
    if not raqb_tree.get("children1"):
        return "1=1"

    return _process_group(raqb_tree, identifier_quote)


def _process_group(group: dict, identifier_quote: str) -> str:
    """Process a RAQB group and generate SQL."""
    children = group.get("children1", {})
    if not children:
        return "1=1"

    conjunction = group.get("properties", {}).get("conjunction", "AND")
    is_not = group.get("properties", {}).get("not", False)
    parts = []

    for child in children.values():
        child_type = child.get("type")
        if child_type == "rule":
            sql = _convert_rule_to_sql(child, identifier_quote)
            if sql:
                parts.append(sql)
        elif child_type == "group":
            nested_sql = _process_group(child, identifier_quote)
            if nested_sql and nested_sql != "1=1":
                if nested_sql.startswith("NOT "):
                    parts.append(nested_sql)
                else:
                    parts.append(f"({nested_sql})")

    if not parts:
        return "1=1"

    if len(parts) == 1:
        result = parts[0]
    else:
        result = f" {conjunction} ".join(parts)

    if is_not:
        return f"NOT ({result})"

    return result


def _convert_rule_to_sql(rule: dict, identifier_quote: str) -> str | None:
    """Convert a single RAQB rule to SQL."""
    props = rule.get("properties", {})
    field = props.get("field")
    operator = props.get("operator")
    value = props.get("value", [])

    if not field or not operator:
        return None

    # Sanitize field name
    safe_field = "".join(c for c in field if c.isalnum() or c == "_")
    quoted_field = f"{identifier_quote}{safe_field}{identifier_quote}"

    return _operator_to_sql(quoted_field, operator, value)


def _operator_to_sql(
    quoted_field: str, operator: str, value: list
) -> str | None:
    """Generate SQL for a specific operator."""
    def escape_value(v):
        if v is None:
            return "NULL"
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, (int, float)):
            if not (v == v) or v in (float("inf"), float("-inf")):  # NaN or Inf check
                raise ValueError("Invalid numeric value")
            return str(v)
        # String escaping
        escaped = str(v).replace("'", "''")
        return f"'{escaped}'"

    match operator:
        case "equal" | "select_equals":
            return f"{quoted_field} = {escape_value(value[0] if value else None)}"

        case "not_equal" | "select_not_equals":
            return f"{quoted_field} <> {escape_value(value[0] if value else None)}"

        case "less":
            return f"{quoted_field} < {escape_value(value[0] if value else None)}"

        case "less_or_equal":
            return f"{quoted_field} <= {escape_value(value[0] if value else None)}"

        case "greater":
            return f"{quoted_field} > {escape_value(value[0] if value else None)}"

        case "greater_or_equal":
            return f"{quoted_field} >= {escape_value(value[0] if value else None)}"

        case "between":
            if len(value) >= 2:
                return f"{quoted_field} BETWEEN {escape_value(value[0])} AND {escape_value(value[1])}"
            return None

        case "not_between":
            if len(value) >= 2:
                return f"{quoted_field} NOT BETWEEN {escape_value(value[0])} AND {escape_value(value[1])}"
            return None

        case "like":
            return f"{quoted_field} ILIKE {escape_value(f'%{value[0]}%' if value else '%')}"

        case "not_like":
            return f"{quoted_field} NOT ILIKE {escape_value(f'%{value[0]}%' if value else '%')}"

        case "starts_with":
            return f"{quoted_field} ILIKE {escape_value(f'{value[0]}%' if value else '%')}"

        case "ends_with":
            return f"{quoted_field} ILIKE {escape_value(f'%{value[0]}' if value else '%')}"

        case "is_null":
            return f"{quoted_field} IS NULL"

        case "is_not_null":
            return f"{quoted_field} IS NOT NULL"

        case "is_empty":
            return f"({quoted_field} IS NULL OR {quoted_field} = '')"

        case "is_not_empty":
            return f"({quoted_field} IS NOT NULL AND {quoted_field} <> '')"

        case "select_any_in":
            if value:
                escaped = ", ".join(escape_value(v) for v in value)
                return f"{quoted_field} IN ({escaped})"
            return None

        case "select_not_any_in":
            if value:
                escaped = ", ".join(escape_value(v) for v in value)
                return f"{quoted_field} NOT IN ({escaped})"
            return None

        case _:
            return None


async def create_transform(
    db: AsyncSession,
    dataset_id: str,
    name: str,
    raqb_json: dict,
    description: str | None = None,
    nl_prompt: str | None = None,
) -> Transform:
    """Create a new transform with both RAQB JSON and cached SQL.

    Checks for duplicate SQL - if a transform with the same cached_sql already
    exists for this dataset, returns the existing transform instead of creating
    a duplicate.

    Args:
        db: Database session
        dataset_id: Parent dataset ID
        name: Transform name
        raqb_json: RAQB tree format filter
        description: Optional description
        nl_prompt: Optional original NL prompt

    Returns:
        Created or existing Transform
    """
    # Generate SQL from RAQB tree
    cached_sql = raqb_to_sql(raqb_json)

    # Check if a transform with this SQL already exists for this dataset
    result = await db.execute(
        select(Transform)
        .where(Transform.dataset_id == dataset_id)
        .where(Transform.cached_sql == cached_sql)
        .order_by(Transform.created_at.asc())  # Return oldest if multiple exist
        .limit(1)
    )
    existing_transform = result.scalar_one_or_none()

    if existing_transform:
        # Return existing transform instead of creating duplicate
        return existing_transform

    # No duplicate found, create new transform
    transform = Transform(
        dataset_id=dataset_id,
        name=name,
        description=description,
        raqb_json=raqb_json,
        cached_sql=cached_sql,
        nl_prompt=nl_prompt,
    )
    db.add(transform)
    await db.commit()
    await db.refresh(transform)
    return transform


async def update_transform(
    db: AsyncSession,
    transform: Transform,
    name: str | None = None,
    description: str | None = None,
    raqb_json: dict | None = None,
    is_active: bool | None = None,
) -> Transform:
    """Update a transform, incrementing version if RAQB changes.

    Args:
        db: Database session
        transform: Transform to update
        name: New name (optional)
        description: New description (optional)
        raqb_json: New RAQB tree (optional, triggers version increment)
        is_active: Whether transform is active (optional)

    Returns:
        Updated Transform
    """
    if name is not None:
        transform.name = name

    if description is not None:
        transform.description = description

    if raqb_json is not None:
        # RAQB changed - increment version and regenerate SQL
        transform.raqb_json = raqb_json
        transform.cached_sql = raqb_to_sql(raqb_json)
        transform.version += 1

    if is_active is not None:
        transform.is_active = is_active

    await db.commit()
    await db.refresh(transform)
    return transform


async def get_aggregated_sql(
    db: AsyncSession,
    dataset_id: str,
) -> tuple[str, list[str]]:
    """Aggregate SQL from all active transforms for a dataset."""
    result = await db.execute(
        select(Transform.id, Transform.cached_sql)
        .distinct(Transform.cached_sql)
        .where(Transform.dataset_id == dataset_id)
        .where(Transform.is_active == True)
        .order_by(Transform.cached_sql, Transform.created_at)
    )
    rows = result.all()

    if not rows:
        return "1=1", []

    transform_ids = [row[0] for row in rows]
    sql_clauses = [f"({row[1]})" for row in rows]
    combined_sql = " AND ".join(sql_clauses)

    return combined_sql, transform_ids
