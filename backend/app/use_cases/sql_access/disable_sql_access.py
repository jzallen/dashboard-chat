"""Disable external SQL access for a project."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access.provisioner import (
    get_app_provisioner,
    get_app_pgbouncer_provisioner,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def disable_sql_access(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Disable external SQL access for a project.

    Deprovisions PgBouncer proxy first, then the pg_duckdb environment
    (container teardown destroys all schemas, roles, and connections),
    then soft-disables the metadata record.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
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

    # Check that SQL access is enabled (with row lock to prevent races)
    existing = await external_access_repo.get_by_project_id_for_update(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Deprovision PgBouncer proxy first (if not legacy)
    if existing.get("proxy_container_id"):
        try:
            pgbouncer = get_app_pgbouncer_provisioner()
            await pgbouncer.deprovision(project_id)
        except Exception:
            logger.warning(
                "PgBouncer deprovision failed for project %s, continuing with pg_duckdb teardown",
                project_id,
                exc_info=True,
            )

    # Deprovision pg_duckdb environment (container teardown destroys everything)
    provisioner = get_app_provisioner()
    await provisioner.deprovision(project_id)

    # Soft-disable the metadata record (clears environment fields)
    await external_access_repo.soft_disable(project_id)

    return {"project_id": project_id, "enabled": False}
