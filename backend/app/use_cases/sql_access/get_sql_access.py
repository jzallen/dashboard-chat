"""Get SQL access details for a project."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_sql_access(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get SQL access connection details for a project.

    Returns connection details (without password) if enabled,
    or a minimal response with enabled=False if not enabled.

    Host and port are read from the ExternalAccessRecord (dynamic per-container).

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    # Get SQL access record
    access_record = await external_access_repo.get_by_project_id(project_id)
    if not access_record or not access_record.enabled:
        return {"project_id": project_id, "enabled": False}

    settings = get_settings()
    return {
        "project_id": project_id,
        "enabled": True,
        "host": access_record.environment_host,
        "port": access_record.environment_port,
        "database": settings.pg_duckdb_database,
        "username": access_record.pg_role,
        "schema": access_record.pg_schema,
        "environment_status": access_record.environment_status or "running",
        "status_message": access_record.status_message,
        "is_legacy": access_record.is_legacy,
        "last_synced_at": access_record.last_synced_at,
        "created_at": access_record.created_at,
    }
