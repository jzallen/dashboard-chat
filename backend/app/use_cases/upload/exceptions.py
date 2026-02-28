"""Upload domain exceptions."""

from app.use_cases.exceptions import DomainException


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
