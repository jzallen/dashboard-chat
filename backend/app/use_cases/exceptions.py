"""Domain exceptions for the application."""


class DomainException(Exception):
    """Base class for domain exceptions."""

    _type: str = "INTERNAL_ERROR"
    _title: str = "Internal Error"
    _status_code: int = 500

    def __init__(self, message: str):
        self._message = message
        super().__init__(message)

    def is_match(self, error_string: str) -> bool:
        return self._message in error_string


class ProjectIdRequired(DomainException):
    """Raised when project_id is required but not provided."""

    _type = "PROJECT_ID_REQUIRED"
    _title = "Project ID Required"
    _status_code = 400

    def __init__(self):
        super().__init__("project_id is required")


class ProjectNotFound(DomainException):
    """Raised when a project is not found."""

    _type = "PROJECT_NOT_FOUND"
    _title = "Project Not Found"
    _status_code = 404

    def __init__(self, project_id: str | None = None):
        msg = f"Project with ID '{project_id}' not found" if project_id else "Project with ID"
        super().__init__(msg)


class DatasetNotFound(DomainException):
    """Raised when a dataset is not found."""

    _type = "DATASET_NOT_FOUND"
    _title = "Dataset Not Found"
    _status_code = 404

    def __init__(self, dataset_id: str | None = None):
        msg = f"Dataset with ID '{dataset_id}' not found" if dataset_id else "Dataset with ID"
        super().__init__(msg)


class UploadNotFound(DomainException):
    """Raised when an upload event is not found."""

    _type = "UPLOAD_NOT_FOUND"
    _title = "Upload Not Found"
    _status_code = 404

    def __init__(self, upload_id: str):
        super().__init__(f"Upload with ID '{upload_id}' not found")


class UploadAlreadyProcessed(DomainException):
    """Raised when trying to process an already processed upload."""

    _type = "UPLOAD_ALREADY_PROCESSED"
    _title = "Upload Already Processed"
    _status_code = 409

    def __init__(self, upload_id: str):
        super().__init__(f"Event {upload_id} has already been processed")


class InvalidFileType(DomainException):
    """Raised when file type is not supported."""

    _type = "INVALID_FILE_TYPE"
    _title = "Invalid File Type"
    _status_code = 400

    def __init__(self):
        super().__init__("Only CSV files are supported")


class EmptyFile(DomainException):
    """Raised when an uploaded file is empty."""

    _type = "EMPTY_FILE"
    _title = "Empty File"
    _status_code = 400

    def __init__(self):
        super().__init__("File is empty")
