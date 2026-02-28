"""Regenerate SQL access credentials for a project."""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.sql_access._infra import (
    ProjectEnvironment,
    generate_password,
    get_app_pgbouncer_provisioner,
    pg_md5_hash,
    regenerate_credentials,
)
from app.use_cases.sql_access.exceptions import CredentialCooldown, SqlAccessNotEnabled

from app.repositories.external_access import AccessRecordWithHash

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def regenerate_sql_credentials(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Regenerate the password for a project's external SQL access.

    Generates a new password, updates the pg_duckdb role, recreates the
    PgBouncer proxy with the new md5 hash, stores the new md5 hash,
    and returns the one-time plaintext password.

    Rate-limited: rejects if updated_at is less than cooldown seconds ago.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
        CredentialCooldown: If regeneration is attempted too soon.
    """
    external_access_repo = repositories.external_access

    project_service = ProjectService(repositories)
    await project_service.fetch_and_authorize_project(project_id, include_datasets=False)

    # Check that SQL access is enabled (fetch with hash for compensation rollback)
    access_record = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not access_record or not access_record.enabled:
        raise SqlAccessNotEnabled(project_id)

    # Rate limiting: check cooldown
    settings = get_settings()
    _enforce_cooldown(access_record, settings.credential_regen_cooldown_seconds)

    # Reconstruct ProjectEnvironment from stored record + settings
    env = ProjectEnvironment(
        environment_id=access_record.environment_id,
        host=access_record.environment_host,
        port=access_record.environment_port,
        database=settings.pg_duckdb_database,
        admin_user=settings.pg_duckdb_admin_user,
        admin_password=settings.pg_duckdb_admin_password,
    )

    # Generate new credentials
    new_password = generate_password()
    pg_role = access_record.pg_role
    md5_hash = pg_md5_hash(new_password, pg_role)

    # Update pg_duckdb role password
    await regenerate_credentials(env, project_id, new_password)

    # Recreate PgBouncer with new md5 hash (if not legacy)
    proxy_container_id = await _rotate_pgbouncer(access_record, project_id, env, md5_hash, pg_role)

    # Update stored hash and proxy container
    update_data = {"pg_password_hash": md5_hash}
    if proxy_container_id:
        update_data["proxy_container_id"] = proxy_container_id
    await external_access_repo.update(project_id, update_data)

    return {
        "host": access_record.environment_host,
        "port": access_record.environment_port,
        "database": settings.pg_duckdb_database,
        "username": pg_role,
        "password": new_password,  # One-time plaintext
        "schema": access_record.pg_schema,
        "connection_string": (
            f"postgresql://{pg_role}:{new_password}"
            f"@{access_record.environment_host}:{access_record.environment_port}"
            f"/{settings.pg_duckdb_database}"
        ),
    }


def _enforce_cooldown(access_record: AccessRecordWithHash, cooldown_seconds: int) -> None:
    """Raise CredentialCooldown if the last update was too recent."""
    if access_record.updated_at:
        updated_at = datetime.fromisoformat(access_record.updated_at)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        elapsed = (datetime.now(UTC) - updated_at).total_seconds()
        if elapsed < cooldown_seconds:
            remaining = int(cooldown_seconds - elapsed) + 1
            raise CredentialCooldown(remaining)


async def _rotate_pgbouncer(
    access_record: AccessRecordWithHash, project_id: str, env, md5_hash: str, pg_role: str
) -> str | None:
    """Recreate PgBouncer with new credentials, compensating on failure."""
    old_md5_hash = access_record.pg_password_hash
    proxy_container_id = access_record.proxy_container_id

    if not proxy_container_id:
        return None

    upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"
    try:
        pgbouncer = get_app_pgbouncer_provisioner()
        return await pgbouncer.recreate(
            project_id=project_id,
            proxy_port=access_record.environment_port,
            md5_hash=md5_hash,
            upstream_host=upstream_host,
            auth_user=pg_role,
        )
    except Exception:
        # Compensate: revert pg_duckdb role to old md5 hash so PgBouncer stays in sync
        logger.error(
            "PgBouncer recreate failed for project %s after credential rotation, reverting role password",
            project_id,
            exc_info=True,
        )
        try:
            await regenerate_credentials(env, project_id, old_md5_hash)
            logger.info("Reverted role password for project %s", project_id)
        except Exception:
            logger.error(
                "Failed to revert role password for project %s — credentials may be inconsistent",
                project_id,
                exc_info=True,
            )
        raise
