"""Regenerate SQL access credentials for a project."""

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._engine import (
    build_project_environment,
    resolve_engine_node_by_id,
)
from app.use_cases.sql_access._infra import (
    generate_password,
    pg_md5_hash,
    regenerate_proxy_credentials,
)
from app.use_cases.sql_access._response import build_connection_response
from app.use_cases.sql_access.exceptions import CredentialCooldown

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
    ctx = await load_context(
        project_id,
        project,
        repositories,
        fetch_variant="with_hash",
        require_enabled=True,
    )
    access_record = ctx.access_record

    settings = get_settings()
    _enforce_cooldown(access_record, settings.credential_regen_cooldown_seconds)

    engine_node = await resolve_engine_node_by_id(access_record.engine_node_id, repositories)

    new_password = generate_password()
    proxy_role = access_record.pg_proxy_role or access_record.pg_role
    md5_hash = pg_md5_hash(new_password, proxy_role)

    env = build_project_environment(engine_node, settings.query_engine_admin_password)
    await regenerate_proxy_credentials(env, project_id, new_password)

    await repositories.external_access.update(project_id, {"pg_password_hash": md5_hash})

    return build_connection_response(
        engine_node,
        schema=access_record.pg_schema,
        username=proxy_role,
        password=new_password,
    )


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
