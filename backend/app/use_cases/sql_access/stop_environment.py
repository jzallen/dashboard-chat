"""Stop a running SQL access environment."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    EnvironmentNotRunning,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access.provisioner import get_app_provisioner

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def stop_environment(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
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
    metadata_repo = repositories['metadata_repository']
    external_access_repo = repositories['external_access_repository']

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=False)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Check that SQL access is enabled and running
    existing = await external_access_repo.get_by_project_id_for_update(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    if existing.get("environment_status") != "running":
        raise EnvironmentNotRunning(project_id)

    # Deprovision pg_duckdb only (keeps metadata and PgBouncer config)
    provisioner = get_app_provisioner()
    await provisioner.stop_environment(project_id)

    # Update status
    await external_access_repo.update(project_id, {
        "environment_status": "stopped",
        "status_message": None,
        "environment_id": None,
    })

    return {
        "project_id": project_id,
        "environment_status": "stopped",
    }
