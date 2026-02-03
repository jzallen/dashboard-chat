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


class UploadNotFound(DomainException):
    """Raised when an upload event is not found."""

    def __init__(self, upload_id: str):
        super().__init__(f"Upload with ID '{upload_id}' not found")


class UploadAlreadyProcessed(DomainException):
    """Raised when trying to process an already processed upload."""

    def __init__(self, upload_id: str, status: str):
        super().__init__(f"Upload '{upload_id}' already has status '{status}'")