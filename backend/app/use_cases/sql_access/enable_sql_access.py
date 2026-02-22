"""Enable external SQL access for a project."""

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
    ProjectNotFound,
    ProjectHasNoDatasets,
    SqlAccessAlreadyEnabled,
)
from app.use_cases.project.dbt.bootstrap_sql import generate_bootstrap_sql
from app.use_cases.project.dbt.naming import to_snake_case, deduplicate_names
from app.use_cases.sql_access.pg_duckdb_manager import (
    schema_name,
    role_name,
    generate_password,
    hash_password,
    create_project_schema,
    drop_project_schema,
    execute_bootstrap,
    grant_schema_usage,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def enable_sql_access(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Enable external SQL access for a project.

    Provisions a pg_duckdb schema and role, runs bootstrap SQL to create
    source views, and stores credentials.

    Returns connection details including the one-time plaintext password.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessAlreadyEnabled: If SQL access is already enabled.
        ProjectHasNoDatasets: If project has no datasets.
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

    # Check for existing enabled access (with row lock to prevent races)
    existing = await external_access_repo.get_by_project_id_for_update(project_id)
    if existing and existing["enabled"]:
        raise SqlAccessAlreadyEnabled(project_id)

    # Verify project has datasets
    sparse_datasets = project_dict.get("datasets", [])
    if not sparse_datasets:
        raise ProjectHasNoDatasets(project_id)

    # Generate credentials
    password = generate_password()
    password_hash = hash_password(password)
    pg_schema = schema_name(project_id)
    pg_role = role_name(project_id)

    # Provision pg_duckdb schema and role, with compensation on failure.
    # DDL commits immediately on the pg_duckdb connection — if bootstrap
    # or grant fails, the orphaned schema/role must be cleaned up.
    await create_project_schema(project_id, password)
    try:
        settings = get_settings()
        full_datasets = []
        for ds_info in sparse_datasets:
            record = await metadata_repo.get_dataset_record(ds_info["id"], include_transforms=True)
            if record:
                full_datasets.append(Dataset.from_record(record, include_transforms=True))

        snake_names = deduplicate_names([to_snake_case(ds.name) for ds in full_datasets])
        dataset_pairs = list(zip(snake_names, full_datasets))
        bootstrap_sql = generate_bootstrap_sql(pg_schema, dataset_pairs, settings.storage_bucket)
        await execute_bootstrap(project_id, bootstrap_sql)
        await grant_schema_usage(project_id)
    except Exception:
        # Compensate: drop the schema/role that was already committed
        logger.warning("Bootstrap failed for project %s, cleaning up pg_duckdb schema", project_id)
        try:
            await drop_project_schema(project_id)
        except Exception:
            logger.error("Cleanup also failed for project %s", project_id, exc_info=True)
        raise

    # Store metadata
    if existing:
        # Re-enable a previously disabled record
        await external_access_repo.update(project_id, {
            "enabled": True,
            "pg_password_hash": password_hash,
            "pg_schema": pg_schema,
            "pg_role": pg_role,
        })
    else:
        await external_access_repo.create(
            project_id=project_id,
            org_id=user.org_id,
            pg_schema=pg_schema,
            pg_role=pg_role,
            pg_password_hash=password_hash,
        )

    return {
        "host": settings.pg_duckdb_external_host,
        "port": settings.pg_duckdb_external_port,
        "database": settings.pg_duckdb_database,
        "username": pg_role,
        "password": password,  # One-time plaintext
        "schema": pg_schema,
        "enabled": True,
        "connection_string": (
            f"postgresql://{pg_role}:{password}"
            f"@{settings.pg_duckdb_external_host}:{settings.pg_duckdb_external_port}"
            f"/{settings.pg_duckdb_database}"
        ),
    }
