"""Shared logic for sql_access use cases.

Provides helpers for storage configuration, bootstrap SQL generation,
and provisioner-based view synchronization.
"""

import logging

from app.config import get_settings
from app.models.dataset import Dataset
from app.use_cases.project._dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project._dbt.naming import resolved_view_names
from app.use_cases.sql_access._infra import QueryEngineProvisioner

logger = logging.getLogger(__name__)


def build_storage_config():
    """Build a StorageConfig from the app settings.

    Prefers minio_internal_endpoint when set; falls back to minio_endpoint.
    """
    from app.use_cases.sql_access._infra import StorageConfig

    settings = get_settings()
    return StorageConfig(
        endpoint=settings.minio_internal_endpoint or settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        region=settings.s3_region,
        url_style="path",
        use_ssl=settings.minio_secure,
    )


async def bootstrap_sql_views_via_provisioner(
    provisioner: QueryEngineProvisioner,
    engine_node_id: str,
    project_id: str,
    pg_schema: str,
    full_datasets: list[Dataset],
    storage_bucket: str,
) -> None:
    """Generate bootstrap SQL and execute via the query engine provisioner."""
    view_names = resolved_view_names(full_datasets)
    dataset_pairs = list(zip(view_names, full_datasets, strict=False))
    bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, storage_bucket)
    await provisioner.sync_views(engine_node_id, project_id, bootstrap_sql)
