"""Domain exceptions for the application."""


class DomainException(Exception):
    """Base class for domain exceptions."""

    pass


class ProjectIdRequired(DomainException):
    """Raised when project_id is required but not provided."""

    def __init__(self):
        super().__init__("project_id is required")

class ProjectNotFound(DomainException):
    """Raised when a project is not found."""

    def __init__(self, project_id: str):
        super().__init__(f"Project with ID '{project_id}' not found")


class RepositoryError(DomainException):
    """Base class for repository errors."""

    pass


class MetadataRepositoryError(RepositoryError):
    """Raised when the application database encounters an error."""

    def __init__(self, message):
        super().__init__(f"Metadata repository error: {message}")
