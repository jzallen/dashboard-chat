"""Session domain exceptions."""

from app.use_cases.exceptions import DomainException


class SessionNotFound(DomainException):
    """Raised when a session is not found."""

    _type = "SESSION_NOT_FOUND"
    _title = "Session Not Found"
    _status_code = 404

    def __init__(self, session_id: str):
        super().__init__(f"Session {session_id} not found")


class SessionAccessDenied(DomainException):
    """Raised when a user is not the session owner."""

    _type = "SESSION_ACCESS_DENIED"
    _title = "Session Access Denied"
    _status_code = 403

    def __init__(self, session_id: str):
        super().__init__(f"Access denied to session {session_id}")
