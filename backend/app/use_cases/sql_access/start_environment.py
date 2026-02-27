"""Start a stopped SQL access environment."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    EnvironmentNotStopped,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.project.dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project.dbt.naming import deduplicate_names, to_snake_case
from app.use_cases.sql_access.pg_duckdb_manager import (
    create_project_schema,
    execute_bootstrap,
    grant_schema_usage,
    regenerate_credentials,
)
from app.use_cases.sql_access.provisioner import (
    StorageConfig,
    get_app_pgbouncer_provisioner,
    get_app_provisioner,
)

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

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=True)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Check that SQL access is enabled and stopped (fetch with hash for PgBouncer recreation)
    existing = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    if existing.get("environment_status") not in ("stopped", "error"):
        raise EnvironmentNotStopped(project_id)

    # Set provisioning status
    await external_access_repo.update(
        project_id,
        {
            "environment_status": "provisioning",
            "status_message": "Starting environment...",
        },
    )

    settings = get_settings()
    storage_config = StorageConfig(
        endpoint=settings.minio_internal_endpoint or settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        region=settings.s3_region,
        url_style="path",
        use_ssl=settings.minio_secure,
    )

    try:
        # Provision pg_duckdb
        provisioner = get_app_provisioner()
        env = await provisioner.start_environment(project_id, storage_config)

        # Re-create schema and role on the fresh container, then set the stored
        # md5 hash as the role password so it matches what PgBouncer expects.
        pg_role = existing["pg_role"]
        await create_project_schema(env, project_id, "temporary")
        await regenerate_credentials(env, project_id, existing["pg_password_hash"])

        # Bootstrap views
        sparse_datasets = project_dict.get("datasets", [])
        full_datasets = []
        for ds_info in sparse_datasets:
            record = await metadata_repo.get_dataset_record(ds_info["id"], include_transforms=True)
            if record:
                full_datasets.append(Dataset.from_record(record, include_transforms=True))

        if full_datasets:
            pg_schema = existing["pg_schema"]
            snake_names = deduplicate_names([to_snake_case(ds.name) for ds in full_datasets])
            dataset_pairs = list(zip(snake_names, full_datasets, strict=False))
            bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, settings.storage_bucket)
            await execute_bootstrap(env, project_id, bootstrap_sql)
            await grant_schema_usage(env, project_id)

        # Recreate PgBouncer if non-legacy
        proxy_container_id = existing.get("proxy_container_id")
        if proxy_container_id or not existing.get("is_legacy"):
            upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"
            try:
                pgbouncer = get_app_pgbouncer_provisioner()
                proxy_container_id = await pgbouncer.recreate(
                    project_id=project_id,
                    proxy_port=existing["environment_port"],
                    md5_hash=existing["pg_password_hash"],
                    upstream_host=upstream_host,
                    auth_user=pg_role,
                )
            except Exception:
                logger.warning(
                    "PgBouncer recreate failed during start for project %s",
                    project_id,
                    exc_info=True,
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
