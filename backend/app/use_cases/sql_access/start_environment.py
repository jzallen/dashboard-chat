"""Start a stopped SQL access environment."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._status import EnvironmentStatusValue as Status
from app.use_cases.sql_access.exceptions import EnvironmentNotStopped, SqlAccessNotEnabled
from app.use_cases.sql_access.sql_access_service import provision_and_bootstrap_environment

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def start_environment(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Start a stopped SQL access environment.

    Validates that the environment is enabled and stopped, then provisions
    pg_duckdb, creates role from stored hash, bootstraps views, and
    recreates PgBouncer. Updates environment_status to "running".

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not enabled.
        EnvironmentNotStopped: If environment is not in stopped state.
    """
    metadata_repo = repositories.metadata
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    # Check that SQL access is enabled and stopped (fetch with hash for PgBouncer recreation)
    access_record = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not access_record or not access_record.enabled:
        raise SqlAccessNotEnabled(project_id)

    if access_record.environment_status not in (Status.STOPPED, Status.ERROR):
        raise EnvironmentNotStopped(project_id)

    # Set provisioning status
    await external_access_repo.update(
        project_id,
        {
            "environment_status": Status.PROVISIONING,
            "status_message": "Starting environment...",
        },
    )

    try:
        proxy_container_id, env = await provision_and_bootstrap_environment(project_id, access_record, metadata_repo)

        # Update record to running
        update_data = {
            "environment_id": env.environment_id,
            "environment_host": env.host,
            "environment_status": Status.RUNNING,
            "status_message": None,
        }
        if proxy_container_id:
            update_data["proxy_container_id"] = proxy_container_id
        await external_access_repo.update(project_id, update_data)

        return {
            "project_id": project_id,
            "environment_status": Status.RUNNING,
        }

    except Exception as e:
        logger.error(
            "Failed to start environment for project %s: %s",
            project_id,
            e,
            exc_info=True,
        )
        await external_access_repo.update(
            project_id,
            {
                "environment_status": Status.ERROR,
                "status_message": str(e),
            },
        )
        raise
