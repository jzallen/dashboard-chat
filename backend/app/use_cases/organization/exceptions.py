"""Organization domain exceptions."""

from app.use_cases.exceptions import DomainException


class OrganizationNameTakenError(DomainException):
    """Raised when an org name collides with an existing org (names are
    globally unique). Distinct from `AuthorizationError("User already belongs
    to an organization")` so callers can tell a name collision apart from the
    idempotent already-has-an-org case."""

    _type = "ORGANIZATION_NAME_TAKEN"
    _title = "Organization name already in use"
    _status_code = 409
