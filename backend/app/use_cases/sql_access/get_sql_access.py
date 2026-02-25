"""Get SQL access details for a project."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_sql_access(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Get SQL access connection details for a project.

    Returns connection details (without password) if enabled,
    or a minimal response with enabled=False if not enabled.

    Host and port are read from the ExternalAccessRecord (dynamic per-container).

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    metadata_repo = repositories['metadata_repository']
    external_access_repo = repositories['external_access_repository']

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=False)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Get SQL access record
    existing = await external_access_repo.get_by_project_id(project_id)
    if not existing or not existing["enabled"]:
        return {"project_id": project_id, "enabled": False}

    settings = get_settings()
    return {
        "project_id": project_id,
        "enabled": True,
        "host": existing["environment_host"],
        "port": existing["environment_port"],
        "database": settings.pg_duckdb_database,
        "username": existing["pg_role"],
        "schema": existing["pg_schema"],
        "last_synced_at": existing["last_synced_at"],
        "created_at": existing["created_at"],
    }
