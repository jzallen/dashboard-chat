"""Assistant-audit domain exceptions."""

from app.use_cases.exceptions import DomainException


class InvalidAuditTag(DomainException):
    """Raised when an audit-entry payload carries a tag outside AUDIT_TAGS."""

    _type = "INVALID_AUDIT_TAG"
    _title = "Invalid Audit Tag"
    _status_code = 400

    def __init__(self, tag: str | None = None):
        super().__init__(f"Audit tag '{tag}' is not in the recognized vocabulary")


class AuditEntryNotFound(DomainException):
    """Raised when an audit entry does not exist OR is owned by another org.

    Cross-org access is indistinguishable from not-found by design (the org
    scope is applied at lookup time).
    """

    _type = "AUDIT_ENTRY_NOT_FOUND"
    _title = "Audit Entry Not Found"
    _status_code = 404

    def __init__(self, assistant_audit_entry_id: str | None = None):
        msg = (
            f"Audit entry with ID '{assistant_audit_entry_id}' not found"
            if assistant_audit_entry_id
            else "Audit entry not found"
        )
        super().__init__(msg)


class AuditEntryNotToggleable(DomainException):
    """Raised when toggling a log-only audit entry (no Transform points at it).

    A entry is transform-type (toggleable) iff a ``Transform`` references it via
    the reversed FK ``transforms.assistant_audit_entry_id``. Log-only entries
    (createView, addJoin, …) have nothing to enable/disable.
    """

    _type = "AUDIT_ENTRY_NOT_TOGGLEABLE"
    _title = "Audit Entry Not Toggleable"
    _status_code = 409

    def __init__(self, assistant_audit_entry_id: str | None = None):
        super().__init__(f"Audit entry '{assistant_audit_entry_id}' has no transform to toggle (log-only)")
