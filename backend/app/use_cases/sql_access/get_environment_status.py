"""Get detailed environment status for a project's SQL access."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._infra import get_app_provisioner
from app.use_cases.sql_access.exceptions import SqlAccessNotEnabled

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
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    # Check that SQL access is enabled
    access_record = await external_access_repo.get_by_project_id(project_id)
    if not access_record or not access_record.enabled:
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
        "environment_status": access_record.environment_status or "running",
        "is_legacy": access_record.is_legacy,
    }
