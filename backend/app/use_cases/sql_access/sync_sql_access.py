"""Sync external SQL access views for a project."""

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.project.dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project.dbt.naming import to_snake_case, deduplicate_names
from app.use_cases.sql_access.pg_duckdb_manager import (
    execute_bootstrap,
    grant_schema_usage,
)
from app.use_cases.sql_access.provisioner import ProjectEnvironment

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def sync_sql_access(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Sync external SQL access views with current dataset state.

    Regenerates bootstrap SQL from current datasets and re-executes it.
    New datasets appear, updated transforms are reflected, removed datasets' views are dropped.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
    """
    metadata_repo = repositories['metadata_repository']
    external_access_repo = repositories['external_access_repository']

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=True)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Check that SQL access is enabled
    existing = await external_access_repo.get_by_project_id(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Reconstruct ProjectEnvironment from stored record + settings
    settings = get_settings()
    env = ProjectEnvironment(
        environment_id=existing["environment_id"],
        host=existing["environment_host"],
        port=existing["environment_port"],
        database=settings.pg_duckdb_database,
        admin_user=settings.pg_duckdb_admin_user,
        admin_password=settings.pg_duckdb_admin_password,
    )

    # Build full datasets for bootstrap SQL generation
    sparse_datasets = project_dict.get("datasets", [])
    full_datasets = []
    for ds_info in sparse_datasets:
        record = await metadata_repo.get_dataset_record(ds_info["id"], include_transforms=True)
        if record:
            full_datasets.append(Dataset.from_record(record, include_transforms=True))

    snake_names = deduplicate_names([to_snake_case(ds.name) for ds in full_datasets])
    dataset_pairs = list(zip(snake_names, full_datasets))

    # Generate and execute bootstrap SQL (drops and recreates all views)
    pg_schema = existing["pg_schema"]
    bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, settings.storage_bucket)
    await execute_bootstrap(env, project_id, bootstrap_sql)

    # Re-grant SELECT on refreshed views
    await grant_schema_usage(env, project_id)

    # Update last_synced_at
    synced_at = datetime.now(timezone.utc)
    await external_access_repo.update(project_id, {
        "last_synced_at": synced_at,
    })

    return {
        "project_id": project_id,
        "last_synced_at": synced_at.isoformat(),
    }
