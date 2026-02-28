"""Sync external SQL access views for a project."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._infra import (
    ProjectEnvironment,
    get_app_provisioner,
)
from app.use_cases.sql_access.exceptions import SqlAccessNotEnabled
from app.use_cases.sql_access.sql_access_service import (
    bootstrap_sql_views,
    fetch_full_datasets,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def sync_sql_access(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Sync external SQL access views with current dataset state.

    Regenerates bootstrap SQL from current datasets and re-executes it.
    New datasets appear, updated transforms are reflected, removed datasets' views are dropped.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
    """
    metadata_repo = repositories["metadata_repository"]
    external_access_repo = repositories["external_access_repository"]

    project_service = ProjectService(repositories)
    project_dict = await project_service.fetch_and_authorize_project(project_id, include_datasets=True)

    # Check that SQL access is enabled
    access_record = await external_access_repo.get_by_project_id(project_id)
    if not access_record or not access_record["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Get live environment from provisioner (includes internal_host/internal_port),
    # falling back to stored record + settings if provisioner can't reach it.
    settings = get_settings()
    provisioner = get_app_provisioner()
    env = await provisioner.get_environment(project_id)
    if env is None:
        env = ProjectEnvironment(
            environment_id=access_record["environment_id"],
            host=access_record["environment_host"],
            port=access_record["environment_port"],
            database=settings.pg_duckdb_database,
            admin_user=settings.pg_duckdb_admin_user,
            admin_password=settings.pg_duckdb_admin_password,
        )

    # Build full datasets and bootstrap SQL views
    sparse_datasets = project_dict.get("datasets", [])
    full_datasets = await fetch_full_datasets(sparse_datasets, metadata_repo)

    await bootstrap_sql_views(env, project_id, access_record["pg_schema"], full_datasets, settings.storage_bucket)

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
