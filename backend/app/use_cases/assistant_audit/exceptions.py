"""Assistant-audit domain exceptions."""

from app.use_cases.exceptions import DomainException


class InvalidAuditTag(DomainException):
    """Raised when an audit-entry payload carries a tag outside AUDIT_TAGS."""

    _type = "INVALID_AUDIT_TAG"
    _title = "Invalid Audit Tag"
    _status_code = 400

    def __init__(self, tag: str | None = None):
        super().__init__(f"Audit tag '{tag}' is not in the recognized vocabulary")
