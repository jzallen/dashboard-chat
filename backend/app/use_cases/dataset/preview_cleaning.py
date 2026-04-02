"""Preview cleaning transform use case — preview without persisting."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.types import CleaningExpression
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.dataset.exceptions import (
    ColumnTypeMismatch,
    InvalidExpressionConfig,
    PreviewNotSupported,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

TEXT_ONLY_OPERATIONS = {"trim", "case"}


def _is_text_type(type_str: str) -> bool:
    """Check if an Ibis/DuckDB type string represents a text column."""
    text_indicators = ("string", "varchar", "text", "utf8", "object")
    return any(t in type_str.lower() for t in text_indicators)


def _build_operation_description(operation: str, config: dict[str, Any], column: str) -> str:
    """Build a human-readable description of a cleaning operation."""
    match operation:
        case "trim":
            return f"Trim whitespace from {column}"
        case "case":
            mode = config.get("mode", "")
            if mode == "snake":
                return f"Convert {column} to snake_case"
            elif mode == "kebab":
                return f"Convert {column} to kebab-case"
            return f"Convert {column} to {mode} case"
        case "fill_null":
            fill_value = config.get("fill_value", "")
            return f"Fill nulls in {column} with '{fill_value}'"
        case "map_values":
            mappings = config.get("mappings", [])
            pairs = [f"{m['from']}->{m['to']}" for m in mappings[:3]]
            suffix = f" and {len(mappings) - 3} more" if len(mappings) > 3 else ""
            return f"Map values in {column}: {', '.join(pairs)}{suffix}"
        case _:
            return f"{operation} on {column}"


def _parse_expression(expression_config: dict[str, Any]) -> CleaningExpression:
    """Parse and validate a cleaning expression config.

    Raises:
        InvalidExpressionConfig: If expression_config is invalid.
        PreviewNotSupported: If the operation does not support preview (e.g., alias).
    """
    try:
        expr = CleaningExpression(expression_config)
    except ValueError as e:
        raise InvalidExpressionConfig(str(e)) from e

    if expr.operation == "alias":
        raise PreviewNotSupported("alias")

    return expr


def _validate_column_for_operation(
    lake_repo,
    storage_path: str,
    target_column: str,
    schema_fields: dict,
    operation: str,
) -> None:
    """Validate the target column exists and is compatible with the operation.

    Raises:
        InvalidExpressionConfig: If column not found in dataset schema.
        ColumnTypeMismatch: If text-only operation targets a non-text column.
    """
    if target_column not in schema_fields:
        raise InvalidExpressionConfig(f"Column '{target_column}' not found in dataset schema")

    column_type = lake_repo.get_parquet_column_type(storage_path, target_column)
    if operation in TEXT_ONLY_OPERATIONS and not _is_text_type(column_type):
        raise ColumnTypeMismatch(target_column, column_type, operation)


@handle_returns
@with_repositories
async def preview_cleaning_transform(
    dataset_id: str,
    target_column: str,
    expression_config: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Preview a cleaning transform without persisting anything.

    Returns affected_count, total_count, samples, column, and operation_description.

    Raises:
        DatasetNotFound: If dataset does not exist.
        AuthorizationError: If user's org does not own the parent project.
        InvalidExpressionConfig: If expression_config is invalid.
        PreviewNotSupported: If operation does not support preview (e.g., alias).
        ColumnTypeMismatch: If text-only operation targets a non-text column.
    """
    lake_repo = repositories.lake

    expr = _parse_expression(expression_config)

    service = DatasetService(repositories)
    record = await service.fetch_dataset_record(dataset_id)

    schema_fields = (record.schema_config or {}).get("fields", {})
    _validate_column_for_operation(
        lake_repo,
        record.storage_path,
        target_column,
        schema_fields,
        expr.operation,
    )

    preview = lake_repo.preview_cleaning_operation(
        storage_path=record.storage_path,
        target_column=target_column,
        expression_config=expression_config,
    )

    return {
        "affected_count": preview["affected_count"],
        "total_count": preview["total_count"],
        "samples": preview["samples"],
        "column": target_column,
        "operation_description": _build_operation_description(expr.operation, expression_config, target_column),
    }
