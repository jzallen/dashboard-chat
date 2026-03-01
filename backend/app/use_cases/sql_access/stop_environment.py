"""Stop a running SQL access environment."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._infra import get_app_provisioner
from app.use_cases.sql_access._status import EnvironmentStatusValue as Status
from app.use_cases.sql_access.exceptions import EnvironmentNotRunning, SqlAccessNotEnabled

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def stop_environment(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Stop a running SQL access environment.

    Deprovisions only the pg_duckdb container (not PgBouncer or metadata).
    Sets environment_status to "stopped".

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not enabled.
        EnvironmentNotRunning: If environment is not running.
    """
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    # Check that SQL access is enabled and running
    access_record = await external_access_repo.get_by_project_id_for_update(project_id)
    if not access_record or not access_record.enabled:
        raise SqlAccessNotEnabled(project_id)

    if access_record.environment_status != Status.RUNNING:
        raise EnvironmentNotRunning(project_id)

    # Deprovision pg_duckdb only (keeps metadata and PgBouncer config)
    provisioner = get_app_provisioner()
    await provisioner.stop_environment(project_id)

    # Update status
    await external_access_repo.update(
        project_id,
        {
            "environment_status": Status.STOPPED,
            "status_message": None,
            "environment_id": None,
        },
    )

    return {
        "project_id": project_id,
        "environment_status": Status.STOPPED,
    }
