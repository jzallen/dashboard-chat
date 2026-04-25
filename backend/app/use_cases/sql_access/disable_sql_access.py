"""Disable external SQL access for a project."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._infra import get_app_query_engine_provisioner

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@handle_returns
@with_repositories
async def disable_sql_access(
    project_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Disable external SQL access for a project.

    Drops the project's schema and roles from the query engine,
    then soft-disables the metadata record.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
    """
    ctx = await load_context(
        project_id,
        project,
        repositories,
        fetch_variant="for_update",
        require_enabled=True,
    )
    access_record = ctx.access_record

    # Drop schema and roles from the engine
    if access_record.engine_node_id:
        provisioner = get_app_query_engine_provisioner()
        await provisioner.drop_project_access(access_record.engine_node_id, project_id)

    # Soft-disable the metadata record
    await repositories.external_access.soft_disable(project_id)

    return {"project_id": project_id, "enabled": False}
