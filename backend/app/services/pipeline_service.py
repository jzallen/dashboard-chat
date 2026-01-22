"""Pipeline service for filter pipeline management and execution."""

import time
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Dataset, FilterPipeline, PipelineRun


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


async def create_pipeline(
    db: AsyncSession,
    dataset_id: str,
    name: str,
    raqb_json: dict,
    description: str | None = None,
    nl_prompt: str | None = None,
) -> FilterPipeline:
    """Create a new filter pipeline with both RAQB JSON and cached SQL.

    Args:
        db: Database session
        dataset_id: Parent dataset ID
        name: Pipeline name
        raqb_json: RAQB tree format filter
        description: Optional description
        nl_prompt: Optional original NL prompt

    Returns:
        Created FilterPipeline
    """
    # Generate SQL from RAQB tree
    cached_sql = raqb_to_sql(raqb_json)

    pipeline = FilterPipeline(
        dataset_id=dataset_id,
        name=name,
        description=description,
        raqb_json=raqb_json,
        cached_sql=cached_sql,
        nl_prompt=nl_prompt,
    )
    db.add(pipeline)
    await db.commit()
    await db.refresh(pipeline)
    return pipeline


async def update_pipeline(
    db: AsyncSession,
    pipeline: FilterPipeline,
    name: str | None = None,
    description: str | None = None,
    raqb_json: dict | None = None,
) -> FilterPipeline:
    """Update a pipeline, incrementing version if RAQB changes.

    Args:
        db: Database session
        pipeline: Pipeline to update
        name: New name (optional)
        description: New description (optional)
        raqb_json: New RAQB tree (optional, triggers version increment)

    Returns:
        Updated FilterPipeline
    """
    if name is not None:
        pipeline.name = name

    if description is not None:
        pipeline.description = description

    if raqb_json is not None:
        # RAQB changed - increment version and regenerate SQL
        pipeline.raqb_json = raqb_json
        pipeline.cached_sql = raqb_to_sql(raqb_json)
        pipeline.version += 1

    await db.commit()
    await db.refresh(pipeline)
    return pipeline


async def execute_pipeline(
    db: AsyncSession,
    pipeline: FilterPipeline,
    limit: int = 100,
    offset: int = 0,
) -> tuple[PipelineRun, list[dict[str, Any]]]:
    """Execute a pipeline against its dataset and record the run.

    Args:
        db: Database session
        pipeline: Pipeline to execute
        limit: Maximum rows to return
        offset: Offset for pagination

    Returns:
        Tuple of (PipelineRun record, result rows)
    """
    # Get dataset
    result = await db.execute(
        select(Dataset).where(Dataset.id == pipeline.dataset_id)
    )
    dataset = result.scalar_one()

    # Create run record
    run = PipelineRun(
        pipeline_id=pipeline.id,
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(run)
    await db.flush()

    start_time = time.time()

    try:
        # Build and execute query
        where_clause = pipeline.cached_sql or "1=1"

        # Count total matching rows
        count_sql = f'SELECT COUNT(*) FROM "{dataset.table_name}" WHERE {where_clause}'
        count_result = await db.execute(text(count_sql))
        total_matching = count_result.scalar()

        # Get paginated results
        query_sql = f'''
            SELECT * FROM "{dataset.table_name}"
            WHERE {where_clause}
            LIMIT :limit OFFSET :offset
        '''
        result = await db.execute(
            text(query_sql), {"limit": limit, "offset": offset}
        )
        rows = result.fetchall()
        columns = result.keys()
        result_rows = [dict(zip(columns, row)) for row in rows]

        # Update run with success
        run.status = "completed"
        run.input_row_count = dataset.row_count
        run.output_row_count = total_matching
        run.execution_time_ms = (time.time() - start_time) * 1000
        run.completed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(run)

        return run, result_rows

    except Exception as e:
        # Update run with failure
        run.status = "failed"
        run.error_message = str(e)
        run.execution_time_ms = (time.time() - start_time) * 1000
        run.completed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(run)

        raise
