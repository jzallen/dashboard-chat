"""Startup reconciliation for external SQL access environments.

Checks all enabled ExternalAccessRecords against the provisioner to
detect orphaned or degraded environments and logs warnings.
Re-applies runtime config (GUC, S3 secrets) on healthy environments.
Checks PgBouncer health for non-legacy records and recreates if exited.
"""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.repositories.external_access import AccessRecordView
from app.use_cases import handle_returns
from app.use_cases.sql_access._infra import (
    StorageConfig,
    configure_s3_secrets,
    ensure_duckdb_role_configured,
    get_app_pgbouncer_provisioner,
    get_app_provisioner,
)
from app.use_cases.sql_access._status import EnvironmentStatusValue as Status
from app.use_cases.sql_access.sql_access_service import build_storage_config

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@handle_returns
@with_repositories
async def reconcile_sql_access(
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Check all enabled environments and log warnings for unhealthy ones.

    For healthy environments, re-applies duckdb.postgres_role GUC and S3 secrets
    as defense-in-depth against config loss after container restarts.

    For non-legacy records, also checks PgBouncer health and recreates if exited.

    Returns a summary dict with counts of total, healthy, and degraded environments.
    """
    provisioner = get_app_provisioner()
    external_access_repo = repositories.external_access
    storage_config = build_storage_config()

    enabled_records = await external_access_repo.list_enabled()

    total = len(enabled_records)
    healthy = 0
    degraded = 0

    for record in enabled_records:
        project_id = record.project_id

        is_healthy = await _check_pgduckdb_health(provisioner, project_id, record, external_access_repo)
        if is_healthy is None:
            degraded += 1
            continue

        if is_healthy:
            await _reapply_runtime_config(provisioner, project_id, storage_config)

            pgbouncer_ok = await _reconcile_pgbouncer(record, project_id, provisioner, external_access_repo)
            if not pgbouncer_ok:
                degraded += 1
                continue

            await external_access_repo.update(
                project_id,
                {"environment_status": Status.RUNNING, "status_message": None},
            )
            healthy += 1
        else:
            logger.warning(
                "Degraded environment for project %s: environment_id=%s, host=%s, port=%s",
                project_id,
                record.environment_id,
                record.environment_host,
                record.environment_port,
            )
            await external_access_repo.update(
                project_id,
                {
                    "environment_status": Status.DEGRADED,
                    "status_message": "pg_duckdb environment not healthy",
                },
            )
            degraded += 1

    logger.info(
        "SQL access reconciliation complete: %d total, %d healthy, %d degraded",
        total,
        healthy,
        degraded,
    )

    return {"total": total, "healthy": healthy, "degraded": degraded}


async def _check_pgduckdb_health(
    provisioner, project_id: str, record: AccessRecordView, external_access_repo
) -> bool | None:
    """Check pg_duckdb health. Returns True/False, or None if the check itself failed."""
    try:
        return await provisioner.health_check(project_id)
    except Exception:
        logger.warning(
            "Health check failed for project %s (environment_id=%s)",
            project_id,
            record.environment_id,
        )
        await external_access_repo.update(
            project_id,
            {
                "environment_status": Status.DEGRADED,
                "status_message": "pg_duckdb health check failed",
            },
        )
        return None


async def _reapply_runtime_config(provisioner, project_id: str, storage_config: StorageConfig) -> None:
    """Re-apply duckdb role GUC and S3 secrets on a healthy environment."""
    env = await provisioner.get_environment(project_id)
    if env is None:
        return

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


async def _reconcile_pgbouncer(record: AccessRecordView, project_id: str, provisioner, external_access_repo) -> bool:
    """Check and reconcile PgBouncer for non-legacy records.

    Returns True if PgBouncer is healthy or not applicable, False if reconciliation failed.
    """
    if record.is_legacy or not record.proxy_container_id:
        return True

    try:
        pgbouncer = get_app_pgbouncer_provisioner()
        pgb_healthy = await pgbouncer.health_check(project_id)
        if not pgb_healthy:
            logger.warning(
                "PgBouncer exited for project %s, attempting recreate",
                project_id,
            )
            await _recreate_pgbouncer(record, project_id, provisioner, pgbouncer, external_access_repo)
    except Exception:
        logger.warning(
            "PgBouncer reconciliation failed for project %s",
            project_id,
            exc_info=True,
        )
        await external_access_repo.update(
            project_id,
            {
                "environment_status": Status.DEGRADED,
                "status_message": "PgBouncer reconciliation failed",
            },
        )
        return False

    return True


async def _recreate_pgbouncer(
    record: AccessRecordView, project_id: str, provisioner, pgbouncer, external_access_repo
) -> None:
    """Recreate a PgBouncer proxy using stored credentials."""
    record_with_hash = await external_access_repo.get_by_project_id_with_hash(project_id)
    stored_md5 = record_with_hash.pg_password_hash if record_with_hash else ""

    env = await provisioner.get_environment(project_id)
    upstream_host = (env.internal_host if env else None) or f"dashboard-pgduckdb-{project_id[:8]}"

    new_container_id = await pgbouncer.recreate(
        project_id=project_id,
        proxy_port=record.environment_port,
        md5_hash=stored_md5,
        upstream_host=upstream_host,
        auth_user=record.pg_role,
    )
    await external_access_repo.update(
        project_id,
        {
            "proxy_container_id": new_container_id,
            "environment_status": Status.RUNNING,
            "status_message": None,
        },
    )
