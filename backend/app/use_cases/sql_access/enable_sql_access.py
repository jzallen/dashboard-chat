"""Enable external SQL access for a project."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import get_session, with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectHasNoDatasets
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._infra import (
    allocate_proxy_port,
    create_project_schema,
    generate_password,
    get_app_pgbouncer_provisioner,
    get_app_provisioner,
    pg_md5_hash,
    role_name,
    schema_name,
)
from app.use_cases.sql_access._status import EnvironmentStatusValue as Status
from app.use_cases.sql_access.exceptions import SqlAccessAlreadyEnabled
from app.use_cases.sql_access.sql_access_service import (
    bootstrap_sql_views,
    build_storage_config,
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
    metadata_repo = repositories.metadata
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id)

    # Check for existing enabled access (with row lock to prevent races)
    access_record = await external_access_repo.get_by_project_id_for_update(project_id)
    if access_record and access_record.enabled:
        raise SqlAccessAlreadyEnabled(project_id)

    # Verify project has datasets
    dataset_records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=False)
    if not dataset_records:
        raise ProjectHasNoDatasets(project_id)

    # Provision ephemeral pg_duckdb environment
    storage_config = build_storage_config()
    provisioner = get_app_provisioner()
    env = await provisioner.provision(project_id, storage_config)

    # Generate credentials
    password = generate_password()
    pg_schema = schema_name(project_id)
    pg_role = role_name(project_id)
    md5_hash = pg_md5_hash(password, pg_role)

    # Create schema/role and bootstrap views, with compensation on failure
    await _setup_schema_and_views(env, project_id, password, pg_schema, metadata_repo, provisioner)

    # Allocate proxy port and provision PgBouncer
    proxy_port, proxy_container_id = await _provision_pgbouncer(project_id, env, md5_hash, pg_role, provisioner)

    # Store metadata
    await _store_access_record(
        external_access_repo,
        project_id,
        access_record,
        md5_hash,
        pg_schema,
        pg_role,
        env,
        proxy_port,
        proxy_container_id,
    )

    return {
        "host": env.host,
        "port": proxy_port,
        "database": env.database,
        "username": pg_role,
        "password": password,  # One-time plaintext
        "schema": pg_schema,
        "enabled": True,
        "environment_status": Status.RUNNING,
        "connection_string": (f"postgresql://{pg_role}:{password}@{env.host}:{proxy_port}/{env.database}"),
    }


async def _setup_schema_and_views(env, project_id, password, pg_schema, metadata_repo, provisioner):
    """Create schema/role, bootstrap SQL views, and grant usage.

    Compensates by deprovisioning the environment if bootstrap fails.
    """
    await create_project_schema(env, project_id, password)
    try:
        settings = get_settings()
        records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=True)
        full_datasets = [Dataset.from_record(r, include_transforms=True) for r in records]
        await bootstrap_sql_views(env, project_id, pg_schema, full_datasets, settings.storage_bucket)
    except Exception:
        logger.warning("Bootstrap failed for project %s, deprovisioning environment", project_id)
        await _compensate_deprovision(provisioner, project_id)
        raise


async def _provision_pgbouncer(project_id, env, md5_hash, pg_role, provisioner):
    """Allocate a proxy port and provision PgBouncer.

    Compensates by deprovisioning pg_duckdb if PgBouncer provisioning fails.
    """
    session = get_session()
    proxy_port = await allocate_proxy_port(session)
    upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"

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
        logger.warning(
            "PgBouncer provisioning failed for project %s, deprovisioning pg_duckdb",
            project_id,
        )
        await _compensate_deprovision(provisioner, project_id)
        raise

    return proxy_port, proxy_container_id


async def _compensate_deprovision(provisioner, project_id: str) -> None:
    """Deprovision pg_duckdb as compensation for a failed step."""
    try:
        await provisioner.deprovision(project_id)
    except Exception:
        logger.error("Cleanup also failed for project %s", project_id, exc_info=True)


async def _store_access_record(
    external_access_repo,
    project_id,
    access_record,
    md5_hash,
    pg_schema,
    pg_role,
    env,
    proxy_port,
    proxy_container_id,
):
    """Store or update the external access metadata record."""
    from app.auth import get_auth_user

    record_data = {
        "enabled": True,
        "pg_password_hash": md5_hash,
        "pg_schema": pg_schema,
        "pg_role": pg_role,
        "environment_id": env.environment_id,
        "environment_host": env.host,
        "environment_port": proxy_port,
        "proxy_container_id": proxy_container_id,
        "environment_status": Status.RUNNING,
    }

    if access_record:
        # Re-enable a previously disabled record
        await external_access_repo.update(project_id, record_data)
    else:
        user = get_auth_user()
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
            environment_status=Status.RUNNING,
        )
