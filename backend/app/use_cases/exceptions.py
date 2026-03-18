"""Domain exceptions for the application.

Base exception class lives here. Domain-specific exceptions are co-located
with their domains (e.g., dataset/exceptions.py, project/exceptions.py).
"""


class DomainException(Exception):
    """Base class for domain exceptions."""

    _type: str = "INTERNAL_ERROR"
    _title: str = "Internal Error"
    _status_code: int = 500

    def __init__(self, message: str):
        super().__init__(message)
