"""pg_duckdb connection manager for external SQL access.

Manages PostgreSQL schemas, roles, and credentials in the shared pg_duckdb instance.
All DDL operations use an admin connection via asyncpg.
"""

import logging
import re
import secrets
import string

import asyncpg
import bcrypt

from app.config import get_settings

logger = logging.getLogger(__name__)

# Naming convention: short_id = first 8 chars of project UUID
SCHEMA_PREFIX = "project_"
ROLE_PREFIX = "reader_"
PASSWORD_LENGTH = 32
CONNECTION_LIMIT = 3

# Strict pattern for identifiers derived from project UUIDs (hex prefix).
# schema_name and role_name must match this — rejects anything unexpected.
_SAFE_IDENT_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


def _short_id(project_id: str) -> str:
    """Derive a short identifier from a project UUID (first 8 chars)."""
    return project_id[:8]


def _validate_ident(name: str) -> str:
    """Validate a SQL identifier matches the expected safe pattern.

    Raises ValueError if the name contains unexpected characters.
    """
    if not _SAFE_IDENT_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


def _quote_ident(name: str) -> str:
    """Double-quote a SQL identifier, escaping embedded double-quotes."""
    return '"' + name.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    """Single-quote a SQL literal, escaping embedded single-quotes."""
    return "'" + value.replace("'", "''") + "'"


def schema_name(project_id: str) -> str:
    """Derive the pg_duckdb schema name for a project."""
    return f"{SCHEMA_PREFIX}{_short_id(project_id)}"


def role_name(project_id: str) -> str:
    """Derive the pg_duckdb role name for a project."""
    return f"{ROLE_PREFIX}{_short_id(project_id)}"


def generate_password() -> str:
    """Generate a cryptographically random password."""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(PASSWORD_LENGTH))


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def build_create_role_sql(role: str, password: str) -> str:
    """Build a CREATE ROLE statement with proper escaping.

    PostgreSQL DDL (CREATE ROLE) does not support $1 parameter placeholders,
    so we must escape the password literal manually.
    """
    _validate_ident(role)
    return (
        f"CREATE ROLE {_quote_ident(role)} LOGIN PASSWORD {_quote_literal(password)}"
        f" CONNECTION LIMIT {CONNECTION_LIMIT}"
    )


def build_alter_role_password_sql(role: str, password: str) -> str:
    """Build an ALTER ROLE PASSWORD statement with proper escaping."""
    _validate_ident(role)
    return f"ALTER ROLE {_quote_ident(role)} PASSWORD {_quote_literal(password)}"


async def _get_admin_connection() -> asyncpg.Connection:
    """Get an admin connection to the pg_duckdb instance."""
    settings = get_settings()
    return await asyncpg.connect(
        host=settings.pg_duckdb_host,
        port=settings.pg_duckdb_port,
        user=settings.pg_duckdb_admin_user,
        password=settings.pg_duckdb_admin_password,
        database=settings.pg_duckdb_database,
    )


async def create_project_schema(project_id: str, password: str) -> None:
    """Create a schema and read-only role for a project.

    Creates:
    - Schema: project_{short_id}
    - Role: reader_{short_id} with LOGIN, CONNECTION LIMIT 3, search_path set
    - Revokes public schema access to prevent catalog enumeration

    Args:
        project_id: Project UUID
        password: Plaintext password for the role
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))

    conn = await _get_admin_connection()
    try:
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS {_quote_ident(schema)}')
        await conn.execute(build_create_role_sql(role, password))
        await conn.execute(f'GRANT USAGE ON SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}')
        await conn.execute(f'REVOKE ALL ON SCHEMA public FROM {_quote_ident(role)}')
        await conn.execute(f'ALTER ROLE {_quote_ident(role)} SET search_path TO {_quote_ident(schema)}')
        logger.info("Created schema %s and role %s for project %s", schema, role, project_id)
    finally:
        await conn.close()


async def drop_project_schema(project_id: str) -> None:
    """Drop a project's schema and role, terminating active connections.

    1. Terminate active connections for the role
    2. DROP SCHEMA CASCADE
    3. DROP ROLE
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))

    conn = await _get_admin_connection()
    try:
        # Terminate active connections for this role (parameterized — safe)
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
            role,
        )
        await conn.execute(f'DROP SCHEMA IF EXISTS {_quote_ident(schema)} CASCADE')
        await conn.execute(f'DROP ROLE IF EXISTS {_quote_ident(role)}')
        logger.info("Dropped schema %s and role %s for project %s", schema, role, project_id)
    finally:
        await conn.close()


async def regenerate_credentials(project_id: str, new_password: str) -> None:
    """Change the password for a project's reader role.

    Args:
        project_id: Project UUID
        new_password: New plaintext password
    """
    role = _validate_ident(role_name(project_id))

    conn = await _get_admin_connection()
    try:
        await conn.execute(build_alter_role_password_sql(role, new_password))
        logger.info("Regenerated credentials for role %s", role)
    finally:
        await conn.close()


async def execute_bootstrap(project_id: str, bootstrap_sql: str) -> None:
    """Execute bootstrap SQL to create/update source views in a project's schema.

    The bootstrap SQL is generated by bootstrap_sql.py and contains:
    - Schema creation
    - View cleanup (drop existing)
    - View creation (read_parquet per dataset)

    Executed transactionally via the admin connection.
    """
    conn = await _get_admin_connection()
    try:
        await conn.execute(bootstrap_sql)
        logger.info("Executed bootstrap SQL for project %s", project_id)
    finally:
        await conn.close()


async def grant_schema_usage(project_id: str) -> None:
    """Grant USAGE and SELECT on all views in a project's schema to the reader role.

    Called after bootstrap to ensure the reader role can access newly created views.
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))

    conn = await _get_admin_connection()
    try:
        await conn.execute(f'GRANT USAGE ON SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}')
        await conn.execute(
            f'GRANT SELECT ON ALL TABLES IN SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}'
        )
        logger.info("Granted schema usage to role %s on schema %s", role, schema)
    finally:
        await conn.close()
