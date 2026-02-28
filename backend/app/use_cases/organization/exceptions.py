"""Organization domain exceptions."""

from app.use_cases.exceptions import DomainException


class ExternalServiceError(DomainException):
    """Raised when an external service call fails."""

    _type = "EXTERNAL_SERVICE_ERROR"
    _title = "External Service Error"
    _status_code = 502
