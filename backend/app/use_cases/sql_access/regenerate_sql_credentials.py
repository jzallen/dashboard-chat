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
    generate_password,
    pg_md5_hash,
    regenerate_proxy_credentials,
)
from app.use_cases.sql_access.exceptions import CredentialCooldown, SqlAccessNotEnabled

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@handle_returns
@with_repositories
async def regenerate_sql_credentials(
    project_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Regenerate the proxy role password for a project's external SQL access.

    Generates a new password, updates the proxy role in the query engine,
    stores the new hash, and returns the one-time plaintext password.

    Rate-limited: rejects if updated_at is less than cooldown seconds ago.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
        CredentialCooldown: If regeneration is attempted too soon.
    """
    external_access_repo = repositories.external_access
    query_engine_repo = repositories.query_engine_node

    if project is None:
        project_service = ProjectService(repositories)
        project = await project_service.fetch_project(project_id)

    # Check that SQL access is enabled (fetch with hash for compensation rollback)
    access_record = await external_access_repo.get_by_project_id_with_hash(project_id)
    if not access_record or not access_record.enabled:
        raise SqlAccessNotEnabled(project_id)

    # Rate limiting: check cooldown
    settings = get_settings()
    _enforce_cooldown(access_record, settings.credential_regen_cooldown_seconds)

    # Get engine node connection details
    engine_node = await query_engine_repo.get_by_id(access_record.engine_node_id)
    if not engine_node:
        raise RuntimeError(f"Engine node '{access_record.engine_node_id}' not found")

    # Generate new proxy credentials
    new_password = generate_password()
    proxy_role = access_record.pg_proxy_role or access_record.pg_role
    md5_hash = pg_md5_hash(new_password, proxy_role)

    # Update proxy role password in the query engine
    from app.use_cases.sql_access._infra import ProjectEnvironment

    env = ProjectEnvironment(
        environment_id=engine_node.id,
        host=engine_node.host,
        port=engine_node.port,
        database=engine_node.database,
        admin_user=engine_node.admin_user,
        admin_password=settings.query_engine_admin_password,
    )
    await regenerate_proxy_credentials(env, project_id, new_password)

    # Update stored hash
    await external_access_repo.update(project_id, {"pg_password_hash": md5_hash})

    return {
        "host": engine_node.host,
        "port": engine_node.port,
        "database": engine_node.database,
        "username": proxy_role,
        "password": new_password,  # One-time plaintext
        "schema": access_record.pg_schema,
        "connection_string": (
            f"postgresql://{proxy_role}:{new_password}@{engine_node.host}:{engine_node.port}/{engine_node.database}"
        ),
    }


def _enforce_cooldown(access_record, cooldown_seconds: int) -> None:
    """Raise CredentialCooldown if the last update was too recent."""
    if access_record.updated_at:
        updated_at = datetime.fromisoformat(access_record.updated_at)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        elapsed = (datetime.now(UTC) - updated_at).total_seconds()
        if elapsed < cooldown_seconds:
            remaining = int(cooldown_seconds - elapsed) + 1
            raise CredentialCooldown(remaining)
