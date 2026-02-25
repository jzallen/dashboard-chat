"""Regenerate SQL access credentials for a project."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import ProjectNotFound, SqlAccessNotEnabled
from app.use_cases.sql_access.pg_duckdb_manager import (
    generate_password,
    hash_password,
    regenerate_credentials,
)
from app.use_cases.sql_access.provisioner import ProjectEnvironment

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def regenerate_sql_credentials(
    project_id: str,
    *,
    repositories: 'RepositoryContainer',
) -> Result[dict, str]:
    """Regenerate the password for a project's external SQL access.

    Generates a new password, updates the pg_duckdb role, stores the new
    bcrypt hash, and returns the one-time plaintext password.

    Existing connections with the old password continue until disconnected.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        SqlAccessNotEnabled: If SQL access is not currently enabled.
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

    # Check that SQL access is enabled
    existing = await external_access_repo.get_by_project_id(project_id)
    if not existing or not existing["enabled"]:
        raise SqlAccessNotEnabled(project_id)

    # Reconstruct ProjectEnvironment from stored record + settings
    settings = get_settings()
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
    new_hash = hash_password(new_password)

    # Update pg_duckdb role password
    await regenerate_credentials(env, project_id, new_password)

    # Update stored hash
    await external_access_repo.update(project_id, {
        "pg_password_hash": new_hash,
    })

    return {
        "host": existing["environment_host"],
        "port": existing["environment_port"],
        "database": settings.pg_duckdb_database,
        "username": existing["pg_role"],
        "password": new_password,  # One-time plaintext
        "schema": existing["pg_schema"],
        "connection_string": (
            f"postgresql://{existing['pg_role']}:{new_password}"
            f"@{existing['environment_host']}:{existing['environment_port']}"
            f"/{settings.pg_duckdb_database}"
        ),
    }
