"""Enable external SQL access for a project."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectHasNoDatasets
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._datasets import load_full_datasets
from app.use_cases.sql_access._engine import ensure_engine_reachable, resolve_engine_node_for_org
from app.use_cases.sql_access._infra import (
    generate_password,
    get_app_query_engine_provisioner,
    pg_md5_hash,
)
from app.use_cases.sql_access._response import build_connection_response
from app.use_cases.sql_access.sql_access_service import bootstrap_sql_views_via_provisioner

if TYPE_CHECKING:
    from app.auth.types import AuthUser
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@handle_returns
@with_repositories
async def enable_sql_access(
    project_id: str,
    user: "AuthUser",
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Enable external SQL access for a project.

    Creates a schema, internal reader role, and proxy role in the org's
    query engine node, bootstraps SQL views, and stores credentials.

    Returns connection details including the one-time plaintext password.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessAlreadyEnabled: If SQL access is already enabled.
        ProjectHasNoDatasets: If project has no datasets.
    """
    metadata_repo = repositories.metadata
    external_access_repo = repositories.external_access

    ctx = await load_context(
        project_id,
        project,
        repositories,
        fetch_variant="for_update",
        forbid_enabled=True,
    )
    project = ctx.project
    access_record = ctx.access_record

    # Verify project has datasets
    early_datasets = await load_full_datasets(
        project_id, metadata_repo, include_transforms=False
    )
    if not early_datasets:
        raise ProjectHasNoDatasets(project_id)

    # Get the org's default engine node
    engine_node = await resolve_engine_node_for_org(user.org_id, repositories)

    # Verify engine is reachable before provisioning
    provisioner = get_app_query_engine_provisioner()
    await ensure_engine_reachable(engine_node, provisioner)

    # Generate credentials and create schema/roles in the engine
    password = generate_password()
    access_info = await provisioner.create_project_access(engine_node.id, project_id, password)

    pg_schema = access_info["pg_schema"]
    pg_role = access_info["pg_role"]
    pg_proxy_role = access_info["pg_proxy_role"]
    md5_hash = pg_md5_hash(password, pg_proxy_role)

    # Bootstrap SQL views
    settings = get_settings()
    full_datasets = await load_full_datasets(
        project_id, metadata_repo, include_transforms=True
    )
    await bootstrap_sql_views_via_provisioner(
        provisioner, engine_node.id, project_id, pg_schema, full_datasets, settings.storage_bucket
    )

    # Store metadata
    record_data = {
        "enabled": True,
        "pg_password_hash": md5_hash,
        "pg_schema": pg_schema,
        "pg_role": pg_role,
        "pg_proxy_role": pg_proxy_role,
        "engine_node_id": engine_node.id,
    }

    if access_record:
        await external_access_repo.update(project_id, record_data)
    else:
        await external_access_repo.create(
            project_id=project_id,
            org_id=user.org_id,
            pg_schema=pg_schema,
            pg_role=pg_role,
            pg_password_hash=md5_hash,
            engine_node_id=engine_node.id,
            pg_proxy_role=pg_proxy_role,
        )

    return build_connection_response(
        engine_node,
        pg_schema,
        pg_proxy_role,
        password=password,
        extras={"enabled": True, "engine_node_id": engine_node.id},
    )
