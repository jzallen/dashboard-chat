"""Start a stopped SQL access environment."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    EnvironmentNotStopped,
    SqlAccessNotEnabled,
)
from app.use_cases.project.project_service import ProjectService
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
    metadata_repo = repositories["metadata_repository"]
    external_access_repo = repositories["external_access_repository"]

    project_service = ProjectService(repositories)
    project_dict = await project_service.fetch_and_authorize_project(
        project_id, include_datasets=True
    )

    # Check that SQL access is enabled and stopped (fetch with hash for PgBouncer recreation)
    access_record = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not access_record or not access_record["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    if access_record.get("environment_status") not in ("stopped", "error"):
        raise EnvironmentNotStopped(project_id)

    # Set provisioning status
    await external_access_repo.update(
        project_id,
        {
            "environment_status": "provisioning",
            "status_message": "Starting environment...",
        },
    )

    sparse_datasets = project_dict.get("datasets", [])

    try:
        proxy_container_id, env = await provision_and_bootstrap_environment(
            project_id, access_record, sparse_datasets, metadata_repo
        )

        # Update record to running
        update_data = {
            "environment_id": env.environment_id,
            "environment_host": env.host,
            "environment_status": "running",
            "status_message": None,
        }
        if proxy_container_id:
            update_data["proxy_container_id"] = proxy_container_id
        await external_access_repo.update(project_id, update_data)

        return {
            "project_id": project_id,
            "environment_status": "running",
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
                "environment_status": "error",
                "status_message": str(e),
            },
        )
        raise
