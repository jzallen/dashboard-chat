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
