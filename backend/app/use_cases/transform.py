"""Transform use cases — batch create, batch update, and preview with outbox audit trail."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.repositories import with_repositories
from app.types import CleaningExpression
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    ColumnTypeMismatch,
    DatasetNotFound,
    InvalidExpressionConfig,
    PreviewNotSupported,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


async def _fetch_and_authorize_dataset(metadata_repo, dataset_id: str):
    """Fetch a dataset record and verify the current user's org owns its parent project.

    Returns:
        The dataset record if found and authorized.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        AuthorizationError: If user's org does not own the parent project.
    """
    record = await metadata_repo.get_dataset_record(dataset_id, include_transforms=False)
    if not record:
        raise DatasetNotFound(dataset_id)

    project = record.project
    user = get_auth_user()
    if project and project.org_id and project.org_id != user.org_id:
        raise AuthorizationError(f"Access denied to dataset {dataset_id}")

    return record


@with_repositories
@handle_returns
async def create_transforms(
    dataset_id: str,
    transforms_input: list[dict[str, Any]],
    *,
    repositories: "RepositoryContainer",
) -> Result[None, str]:
    """Batch-create transforms on a dataset.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        AuthorizationError: If user's org does not own the parent project.
    """
    metadata_repo = repositories["metadata_repository"]
    outbox_repo = repositories["outbox_repository"]

    await _fetch_and_authorize_dataset(metadata_repo, dataset_id)

    # Server-side expression_sql generation for non-filter transforms (design D1)
    for t in transforms_input:
        transform_type = t.get("transform_type", "filter")
        if transform_type != "filter" and t.get("expression_config"):
            expr = CleaningExpression(t["expression_config"])
            column = t.get("target_column", "")
            # Always overwrite client-provided expression_sql with server-generated value
            t["expression_sql"] = expr.to_display_sql(column)

    created = await metadata_repo.create_transforms_batch(dataset_id, transforms_input)

    await outbox_repo.submit_transforms_created_event(
        dataset_id=dataset_id,
        transforms=created,
    )


@with_repositories
@handle_returns
async def update_transforms(
    dataset_id: str,
    updates: list[dict[str, Any]],
    *,
    repositories: "RepositoryContainer",
) -> Result[None, str]:
    """Batch-update transforms (including soft-delete via status='deleted').

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        AuthorizationError: If user's org does not own the parent project.
    """
    metadata_repo = repositories["metadata_repository"]
    outbox_repo = repositories["outbox_repository"]

    await _fetch_and_authorize_dataset(metadata_repo, dataset_id)

    await metadata_repo.update_transforms(updates)

    await outbox_repo.submit_transforms_updated_event(
        dataset_id=dataset_id,
        changes=updates,
    )


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


TEXT_ONLY_OPERATIONS = {"trim", "case"}


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


@with_repositories
@handle_returns
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
    metadata_repo = repositories["metadata_repository"]
    lake_repo = repositories["lake_repository"]

    expr = _parse_expression(expression_config)

    record = await _fetch_and_authorize_dataset(metadata_repo, dataset_id)

    schema_fields = (record.schema_config or {}).get("fields", {})
    _validate_column_for_operation(
        lake_repo, record.storage_path, target_column, schema_fields, expr.operation,
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
