"""Dataset domain exceptions."""

from app.use_cases.exceptions import DomainException


class DatasetNotFound(DomainException):
    """Raised when a dataset is not found."""

    _type = "DATASET_NOT_FOUND"
    _title = "Dataset Not Found"
    _status_code = 404

    def __init__(self, dataset_id: str | None = None):
        msg = f"Dataset with ID '{dataset_id}' not found" if dataset_id else "Dataset with ID"
        super().__init__(msg)


class ModelNameCollision(DomainException):
    """Raised when a dataset's edited dbt machine name (``model_name``) would
    collide with a sibling dataset's resolved warehouse view name in the same
    project. Project-scoped uniqueness keeps two datasets from repointing to
    the same live view."""

    _type = "MODEL_NAME_COLLISION"
    _title = "Model Name Already In Use"
    _status_code = 409

    def __init__(self, model_name: str):
        super().__init__(
            f"The warehouse machine name '{model_name}' is already used by another dataset in this project"
        )


class InvalidExpressionConfig(DomainException):
    """Raised when expression_config is invalid for the given operation."""

    _type = "INVALID_EXPRESSION_CONFIG"
    _title = "Invalid Expression Config"
    _status_code = 400


class ColumnTypeMismatch(DomainException):
    """Raised when a text-only operation targets a non-text column."""

    _type = "COLUMN_TYPE_MISMATCH"
    _title = "Column Type Mismatch"
    _status_code = 422

    def __init__(self, column: str, column_type: str, operation: str):
        super().__init__(f"Operation '{operation}' requires a text column, but '{column}' is of type '{column_type}'")


class PreviewNotSupported(DomainException):
    """Raised when preview is requested for an operation that doesn't support it."""

    _type = "PREVIEW_NOT_SUPPORTED"
    _title = "Preview Not Supported"
    _status_code = 400

    def __init__(self, operation: str):
        super().__init__(f"Operation '{operation}' does not support preview")
