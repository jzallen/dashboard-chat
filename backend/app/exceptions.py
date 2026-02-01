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


class DatasetNotFound(DomainException):
    """Raised when a dataset is not found."""

    def __init__(self, dataset_id: str):
        super().__init__(f"Dataset with ID '{dataset_id}' not found")


class RepositoryError(DomainException):
    """Base class for repository errors."""

    pass


class MetadataRepositoryError(RepositoryError):
    """Raised when the metadata database encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"Metadata repository error: {message}")


class LakeRepositoryError(RepositoryError):
    """Raised when the data lake storage encounters an error."""

    def __init__(self, message: str):
        super().__init__(f"Lake repository error: {message}")
