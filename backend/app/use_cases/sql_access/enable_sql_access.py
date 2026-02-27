"""Enable external SQL access for a project."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import get_session, with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    ProjectHasNoDatasets,
    ProjectNotFound,
    SqlAccessAlreadyEnabled,
)
from app.use_cases.project.dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project.dbt.naming import deduplicate_names, to_snake_case
from app.use_cases.sql_access.pg_duckdb_manager import (
    create_project_schema,
    execute_bootstrap,
    generate_password,
    grant_schema_usage,
    pg_md5_hash,
    role_name,
    schema_name,
)
from app.use_cases.sql_access.port_allocation import allocate_proxy_port
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
async def enable_sql_access(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Enable external SQL access for a project.

    Provisions an ephemeral pg_duckdb container, creates a schema and role,
    runs bootstrap SQL to create source views, provisions a PgBouncer proxy,
    and stores credentials.

    Returns connection details including the one-time plaintext password.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessAlreadyEnabled: If SQL access is already enabled.
        ProjectHasNoDatasets: If project has no datasets.
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

    # Check for existing enabled access (with row lock to prevent races)
    existing = await external_access_repo.get_by_project_id_for_update(project_id)
    if existing and existing["enabled"]:
        raise SqlAccessAlreadyEnabled(project_id)

    # Verify project has datasets
    sparse_datasets = project_dict.get("datasets", [])
    if not sparse_datasets:
        raise ProjectHasNoDatasets(project_id)

    # Build storage config from settings
    settings = get_settings()
    storage_config = StorageConfig(
        endpoint=settings.minio_internal_endpoint or settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        region=settings.s3_region,
        url_style="path",
        use_ssl=settings.minio_secure,
    )

    # Provision ephemeral pg_duckdb environment
    provisioner = get_app_provisioner()
    env = await provisioner.provision(project_id, storage_config)

    # Generate credentials
    password = generate_password()
    pg_schema = schema_name(project_id)
    pg_role = role_name(project_id)
    md5_hash = pg_md5_hash(password, pg_role)

    # Create schema/role and bootstrap views, with compensation on failure.
    # If bootstrap or grant fails, deprovision the environment to clean up.
    await create_project_schema(env, project_id, password)
    try:
        full_datasets = []
        for ds_info in sparse_datasets:
            record = await metadata_repo.get_dataset_record(ds_info["id"], include_transforms=True)
            if record:
                full_datasets.append(Dataset.from_record(record, include_transforms=True))

        snake_names = deduplicate_names([to_snake_case(ds.name) for ds in full_datasets])
        dataset_pairs = list(zip(snake_names, full_datasets, strict=False))
        bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, settings.storage_bucket)
        await execute_bootstrap(env, project_id, bootstrap_sql)
        await grant_schema_usage(env, project_id)
    except Exception:
        # Compensate: deprovision the environment (destroys container + all schemas/roles)
        logger.warning("Bootstrap failed for project %s, deprovisioning environment", project_id)
        try:
            await provisioner.deprovision(project_id)
        except Exception:
            logger.error("Cleanup also failed for project %s", project_id, exc_info=True)
        raise

    # Allocate proxy port and provision PgBouncer
    session = get_session()
    proxy_port = await allocate_proxy_port(session)
    upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"
    proxy_container_id = None

    try:
        pgbouncer = get_app_pgbouncer_provisioner()
        proxy_container_id = await pgbouncer.provision(
            project_id=project_id,
            proxy_port=proxy_port,
            md5_hash=md5_hash,
            upstream_host=upstream_host,
            auth_user=pg_role,
        )
    except Exception:
        # Compensate: deprovision pg_duckdb on PgBouncer failure
        logger.warning(
            "PgBouncer provisioning failed for project %s, deprovisioning pg_duckdb",
            project_id,
        )
        try:
            await provisioner.deprovision(project_id)
        except Exception:
            logger.error("pg_duckdb cleanup also failed for project %s", project_id, exc_info=True)
        raise

    # Store metadata with environment fields
    # Store md5 hash (not bcrypt) — PgBouncer and lifecycle ops need the pg-compatible hash
    record_data = {
        "enabled": True,
        "pg_password_hash": md5_hash,
        "pg_schema": pg_schema,
        "pg_role": pg_role,
        "environment_id": env.environment_id,
        "environment_host": env.host,
        "environment_port": proxy_port,
        "proxy_container_id": proxy_container_id,
        "environment_status": "running",
    }

    if existing:
        # Re-enable a previously disabled record
        await external_access_repo.update(project_id, record_data)
    else:
        await external_access_repo.create(
            project_id=project_id,
            org_id=user.org_id,
            pg_schema=pg_schema,
            pg_role=pg_role,
            pg_password_hash=md5_hash,
            environment_id=env.environment_id,
            environment_host=env.host,
            environment_port=proxy_port,
            proxy_container_id=proxy_container_id,
            environment_status="running",
        )

    return {
        "host": env.host,
        "port": proxy_port,
        "database": env.database,
        "username": pg_role,
        "password": password,  # One-time plaintext
        "schema": pg_schema,
        "enabled": True,
        "environment_status": "running",
        "connection_string": (f"postgresql://{pg_role}:{password}@{env.host}:{proxy_port}/{env.database}"),
    }
