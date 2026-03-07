"""Shared logic for sql_access use cases.

Provides helpers for storage configuration, dataset fetching and bootstrap,
and environment provisioning patterns shared across multiple sql_access use cases.
"""

import logging

from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories.external_access import AccessRecordWithHash
from app.use_cases.project._dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project._dbt.naming import deduplicate_names, to_snake_case
from app.use_cases.sql_access._infra import (
    ProjectEnvironment,
    StorageConfig,
    create_project_schema,
    execute_bootstrap,
    get_app_pgbouncer_provisioner,
    get_app_provisioner,
    grant_schema_usage,
    regenerate_credentials,
)

logger = logging.getLogger(__name__)


def build_storage_config() -> StorageConfig:
    """Build a StorageConfig from the app settings.

    Prefers minio_internal_endpoint when set; falls back to minio_endpoint.
    """
    settings = get_settings()
    return StorageConfig(
        endpoint=settings.minio_internal_endpoint or settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        region=settings.s3_region,
        url_style="path",
        use_ssl=settings.minio_secure,
    )


async def bootstrap_sql_views(
    env: ProjectEnvironment,
    project_id: str,
    pg_schema: str,
    full_datasets: list[Dataset],
    storage_bucket: str,
) -> None:
    """Generate and execute bootstrap SQL, then grant schema usage.

    Creates source views for all datasets and grants SELECT to the project role.
    """
    snake_names = deduplicate_names([to_snake_case(ds.name) for ds in full_datasets])
    dataset_pairs = list(zip(snake_names, full_datasets, strict=False))
    bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, storage_bucket)
    await execute_bootstrap(env, project_id, bootstrap_sql)
    await grant_schema_usage(env, project_id)


async def provision_and_bootstrap_environment(
    project_id: str,
    access_record: AccessRecordWithHash,
    metadata_repo,
) -> tuple[str | None, ProjectEnvironment]:
    """Provision a pg_duckdb environment and bootstrap SQL views.

    Shared by start_environment and restart_environment. Handles:
    1. Provisioning pg_duckdb via start_environment
    2. Creating schema/role and setting stored password hash
    3. Bootstrapping SQL views from current datasets
    4. Recreating PgBouncer proxy if non-legacy

    Returns (proxy_container_id, env) tuple.
    """
    storage_config = build_storage_config()
    settings = get_settings()

    provisioner = get_app_provisioner()
    env = await provisioner.start_environment(project_id, storage_config)

    # Re-create schema and role on the fresh container, then set the stored
    # md5 hash as the role password so it matches what PgBouncer expects.
    await create_project_schema(env, project_id, "temporary")
    await regenerate_credentials(env, project_id, access_record.pg_password_hash)

    # Bootstrap views
    records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=True)
    full_datasets = [Dataset.from_record(r, include_transforms=True) for r in records]
    if full_datasets:
        await bootstrap_sql_views(
            env,
            project_id,
            access_record.pg_schema,
            full_datasets,
            settings.storage_bucket,
        )

    # Recreate PgBouncer if non-legacy
    proxy_container_id = access_record.proxy_container_id
    if proxy_container_id or not access_record.is_legacy:
        upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"
        try:
            pgbouncer = get_app_pgbouncer_provisioner()
            proxy_container_id = await pgbouncer.recreate(
                project_id=project_id,
                proxy_port=access_record.environment_port,
                md5_hash=access_record.pg_password_hash,
                upstream_host=upstream_host,
                auth_user=access_record.pg_role,
            )
        except Exception:
            logger.warning(
                "PgBouncer recreate failed during environment provisioning for project %s",
                project_id,
                exc_info=True,
            )

    return proxy_container_id, env
