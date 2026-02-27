"""Get detailed environment status for a project's SQL access."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access.provisioner import get_app_provisioner

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_environment_status(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get detailed status of all environment components.

    Returns pg_duckdb and PgBouncer running state, overall status, and message.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not enabled.
    """
    metadata_repo = repositories["metadata_repository"]
    external_access_repo = repositories["external_access_repository"]

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=False)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Check that SQL access is enabled
    existing = await external_access_repo.get_by_project_id(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Get detailed status from provisioner
    provisioner = get_app_provisioner()
    detailed = await provisioner.get_detailed_status(project_id)

    return {
        "project_id": project_id,
        "pgduckdb_running": detailed.pgduckdb_running,
        "pgbouncer_running": detailed.pgbouncer_running,
        "status": detailed.status,
        "message": detailed.message,
        "environment_status": existing.get("environment_status", "running"),
        "is_legacy": existing.get("is_legacy", False),
    }
