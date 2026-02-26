"""Startup reconciliation for external SQL access environments.

Checks all enabled ExternalAccessRecords against the provisioner to
detect orphaned or degraded environments and logs warnings.
Re-applies runtime config (GUC, S3 secrets) on healthy environments.
"""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.sql_access.pg_duckdb_manager import (
    configure_s3_secrets,
    ensure_duckdb_role_configured,
)
from app.use_cases.sql_access.provisioner import (
    StorageConfig,
    get_app_provisioner,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def reconcile_sql_access(
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Check all enabled environments and log warnings for unhealthy ones.

    For healthy environments, re-applies duckdb.postgres_role GUC and S3 secrets
    as defense-in-depth against config loss after container restarts.

    Returns a summary dict with counts of total, healthy, and degraded environments.
    """
    provisioner = get_app_provisioner()
    external_access_repo = repositories['external_access_repository']

    # Build storage config for re-applying secrets on healthy environments
    settings = get_settings()
    storage_config = StorageConfig(
        endpoint=settings.minio_internal_endpoint or settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        region=settings.s3_region,
        url_style="path",
        use_ssl=settings.minio_secure,
    )

    enabled_records = await external_access_repo.list_enabled()

    total = len(enabled_records)
    healthy = 0
    degraded = 0

    for record in enabled_records:
        project_id = record["project_id"]
        try:
            is_healthy = await provisioner.health_check(project_id)
        except Exception:
            logger.warning(
                "Health check failed for project %s (environment_id=%s)",
                project_id,
                record.get("environment_id"),
            )
            degraded += 1
            continue

        if is_healthy:
            healthy += 1
            # Re-apply runtime config on healthy environments
            env = await provisioner.get_environment(project_id)
            if env is not None:
                try:
                    await ensure_duckdb_role_configured(env)
                except Exception:
                    logger.warning(
                        "Failed to re-apply duckdb role config for project %s",
                        project_id,
                        exc_info=True,
                    )
                try:
                    await configure_s3_secrets(env, storage_config)
                except Exception:
                    logger.warning(
                        "Failed to re-apply S3 secrets for project %s",
                        project_id,
                        exc_info=True,
                    )
        else:
            logger.warning(
                "Degraded environment for project %s: environment_id=%s, host=%s, port=%s",
                project_id,
                record.get("environment_id"),
                record.get("environment_host"),
                record.get("environment_port"),
            )
            degraded += 1

    logger.info(
        "SQL access reconciliation complete: %d total, %d healthy, %d degraded",
        total, healthy, degraded,
    )

    return {
        "total": total,
        "healthy": healthy,
        "degraded": degraded,
    }
