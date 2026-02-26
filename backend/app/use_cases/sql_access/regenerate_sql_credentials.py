"""Regenerate SQL access credentials for a project."""

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    CredentialCooldown,
    ProjectNotFound,
    SqlAccessNotEnabled,
)
from app.use_cases.sql_access.pg_duckdb_manager import (
    generate_password,
    pg_md5_hash,
    regenerate_credentials,
    role_name,
)
from app.use_cases.sql_access.provisioner import (
    ProjectEnvironment,
    get_app_pgbouncer_provisioner,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@with_repositories
@handle_returns
async def regenerate_sql_credentials(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
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
    metadata_repo = repositories['metadata_repository']
    external_access_repo = repositories['external_access_repository']

    # Fetch and authorize project
    project_dict = await metadata_repo.get_project(project_id, include_datasets=False)
    if project_dict is None:
        raise ProjectNotFound(project_id)

    user = get_auth_user()
    if project_dict.get("org_id") != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    # Check that SQL access is enabled (fetch with hash for compensation rollback)
    existing = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Rate limiting: check cooldown
    settings = get_settings()
    if existing.get("updated_at"):
        updated_at = datetime.fromisoformat(existing["updated_at"])
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - updated_at).total_seconds()
        if elapsed < settings.credential_regen_cooldown_seconds:
            remaining = int(settings.credential_regen_cooldown_seconds - elapsed) + 1
            raise CredentialCooldown(remaining)

    # Reconstruct ProjectEnvironment from stored record + settings
    env = ProjectEnvironment(
        environment_id=existing["environment_id"],
        host=existing["environment_host"],
        port=existing["environment_port"],
        database=settings.pg_duckdb_database,
        admin_user=settings.pg_duckdb_admin_user,
        admin_password=settings.pg_duckdb_admin_password,
    )

    # Generate new credentials
    new_password = generate_password()
    pg_role = existing["pg_role"]
    md5_hash = pg_md5_hash(new_password, pg_role)

    # Update pg_duckdb role password
    await regenerate_credentials(env, project_id, new_password)

    # Recreate PgBouncer with new md5 hash (if not legacy)
    old_md5_hash = existing["pg_password_hash"]
    proxy_container_id = existing.get("proxy_container_id")
    if proxy_container_id:
        upstream_host = env.internal_host or f"dashboard-pgduckdb-{project_id[:8]}"
        try:
            pgbouncer = get_app_pgbouncer_provisioner()
            proxy_container_id = await pgbouncer.recreate(
                project_id=project_id,
                proxy_port=existing["environment_port"],
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

    # Update stored hash and proxy container
    # Store md5 hash (not bcrypt) — PgBouncer and lifecycle ops need the pg-compatible hash
    update_data = {"pg_password_hash": md5_hash}
    if proxy_container_id:
        update_data["proxy_container_id"] = proxy_container_id
    await external_access_repo.update(project_id, update_data)

    return {
        "host": existing["environment_host"],
        "port": existing["environment_port"],
        "database": settings.pg_duckdb_database,
        "username": pg_role,
        "password": new_password,  # One-time plaintext
        "schema": existing["pg_schema"],
        "connection_string": (
            f"postgresql://{pg_role}:{new_password}"
            f"@{existing['environment_host']}:{existing['environment_port']}"
            f"/{settings.pg_duckdb_database}"
        ),
    }
