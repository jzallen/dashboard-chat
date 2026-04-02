"""SQL access domain exceptions."""

from app.use_cases.exceptions import DomainException


class SqlAccessAlreadyEnabled(DomainException):
    """Raised when SQL access is already enabled for a project."""

    _type = "SQL_ACCESS_ALREADY_ENABLED"
    _title = "SQL Access Already Enabled"
    _status_code = 409

    def __init__(self, project_id: str):
        super().__init__(f"SQL access is already enabled for project '{project_id}'")


class SqlAccessNotEnabled(DomainException):
    """Raised when SQL access is not enabled for a project."""

    _type = "SQL_ACCESS_NOT_ENABLED"
    _title = "SQL Access Not Enabled"
    _status_code = 404

    def __init__(self, project_id: str):
        super().__init__(f"SQL access is not enabled for project '{project_id}'")


class CredentialCooldown(DomainException):
    """Raised when credential regeneration is attempted too soon."""

    _type = "CREDENTIAL_COOLDOWN"
    _title = "Credential Regeneration Too Soon"
    _status_code = 429

    def __init__(self, seconds_remaining: int):
        self.retry_after = seconds_remaining
        super().__init__(f"Credential regeneration is rate-limited. Try again in {seconds_remaining} seconds.")


class EnvironmentNotRunning(DomainException):
    """Raised when an operation requires a running environment but it is not running."""

    _type = "ENVIRONMENT_NOT_RUNNING"
    _title = "Environment Not Running"
    _status_code = 409

    def __init__(self, project_id: str):
        super().__init__(f"Environment for project '{project_id}' is not running")


class EnvironmentNotStopped(DomainException):
    """Raised when an operation requires a stopped environment but it is not stopped."""

    _type = "ENVIRONMENT_NOT_STOPPED"
    _title = "Environment Not Stopped"
    _status_code = 409

    def __init__(self, project_id: str):
        super().__init__(f"Environment for project '{project_id}' is not stopped")


class QueryEngineUnreachable(DomainException):
    """Raised when a query engine node is not reachable."""

    _type = "QUERY_ENGINE_UNREACHABLE"
    _title = "Query Engine Unreachable"
    _status_code = 502

    def __init__(self, engine_node_id: str):
        super().__init__(f"Query engine node '{engine_node_id}' is not reachable")
