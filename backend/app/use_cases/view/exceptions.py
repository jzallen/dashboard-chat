"""View domain exceptions."""

from app.use_cases.exceptions import DomainException


class ViewNotFound(DomainException):
    """Raised when a view is not found."""

    _type = "VIEW_NOT_FOUND"
    _title = "View Not Found"
    _status_code = 404

    def __init__(self, view_id: str | None = None):
        msg = f"View with ID '{view_id}' not found" if view_id else "View not found"
        super().__init__(msg)


class InvalidSourceReference(DomainException):
    """Raised when source references point to non-existent entities."""

    _type = "INVALID_SOURCE_REFERENCE"
    _title = "Invalid Source Reference"
    _status_code = 400

    def __init__(self, missing_ids: list[str]):
        super().__init__(f"Source references not found: {', '.join(missing_ids)}")


class CircularDependency(DomainException):
    """Raised when a circular dependency is detected in the view graph."""

    _type = "CIRCULAR_DEPENDENCY"
    _title = "Circular Dependency"
    _status_code = 400

    def __init__(self, view_id: str):
        super().__init__(f"Circular dependency detected involving view '{view_id}'")


class InvalidViewFilter(DomainException):
    """Raised when a view filter fails validation at the use-case boundary.

    ADR-026 MR-1 makes ``ViewFilter`` a Pydantic discriminated union over
    ``operator``; malformed operators (e.g. ``DELETE_ALL``) or values of the
    wrong arity surface here as a structured 400 with a ``rejected_field``
    pointer so the agent / controller can render a named-field error rather
    than a generic 500.
    """

    _type = "INVALID_VIEW_FILTER"
    _title = "Invalid View Filter"
    _status_code = 400

    def __init__(self, message: str, rejected_field: str = "operator"):
        super().__init__(message)
        self.rejected_field = rejected_field
