"""Sync external SQL access views for a project."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._datasets import load_full_datasets
from app.use_cases.sql_access._infra import get_app_query_engine_provisioner
from app.use_cases.sql_access.sql_access_service import bootstrap_sql_views_via_provisioner

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def sync_sql_access(
    project_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Sync external SQL access views with current dataset state.

    Regenerates bootstrap SQL from current datasets and re-executes it
    via the query engine provisioner.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
    """
    metadata_repo = repositories.metadata
    external_access_repo = repositories.external_access

    ctx = await load_context(
        project_id,
        project,
        repositories,
        fetch_variant="plain",
        require_enabled=True,
    )

    settings = get_settings()
    provisioner = get_app_query_engine_provisioner()

    full_datasets = await load_full_datasets(
        project_id, metadata_repo, include_transforms=True
    )

    await bootstrap_sql_views_via_provisioner(
        provisioner,
        ctx.access_record.engine_node_id,
        project_id,
        ctx.access_record.pg_schema,
        full_datasets,
        settings.storage_bucket,
    )

    # Update last_synced_at
    synced_at = datetime.now(UTC)
    await external_access_repo.update(
        project_id,
        {"last_synced_at": synced_at},
    )

    return {
        "project_id": project_id,
        "last_synced_at": synced_at.isoformat(),
    }
