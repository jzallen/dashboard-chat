"""Startup reconciliation for external SQL access environments.

Checks all enabled ExternalAccessRecords against the provisioner to
detect orphaned or degraded environments and logs warnings.
"""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.sql_access.provisioner import get_app_provisioner

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

    Returns a summary dict with counts of total, healthy, and degraded environments.
    """
    provisioner = get_app_provisioner()
    external_access_repo = repositories['external_access_repository']

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
