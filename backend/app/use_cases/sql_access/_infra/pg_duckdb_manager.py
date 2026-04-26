"""pg_duckdb connection manager for external SQL access.

Manages PostgreSQL schemas, roles, and credentials in pg_duckdb environments.
All DDL operations use an admin connection via asyncpg against a ProjectEnvironment.
"""

import hashlib
import logging
import secrets
import string

import asyncpg
import bcrypt

from app.config import get_settings
from app.utils.sql_safety import quote_ident as _quote_ident
from app.utils.sql_safety import quote_literal as _quote_literal
from app.utils.sql_safety import validate_identifier as _validate_ident

from .provisioner import ProjectEnvironment

logger = logging.getLogger(__name__)

# Naming convention: short_id = first 8 chars of project UUID
SCHEMA_PREFIX = "project_"
ROLE_PREFIX = "reader_"
PROXY_ROLE_PREFIX = "proxy_"
PASSWORD_LENGTH = 32

# Group role for duckdb.postgres_role GUC — shared across all reader roles
DUCKDB_READERS_GROUP = "duckdb_readers"


def _short_id(project_id: str) -> str:
    """Derive a short identifier from a project UUID (first 8 chars)."""
    return project_id[:8]


def schema_name(project_id: str) -> str:
    """Derive the pg_duckdb schema name for a project."""
    return f"{SCHEMA_PREFIX}{_short_id(project_id)}"


def role_name(project_id: str) -> str:
    """Derive the pg_duckdb role name for a project."""
    return f"{ROLE_PREFIX}{_short_id(project_id)}"


def proxy_role_name(project_id: str) -> str:
    """Derive the pg_duckdb proxy role name for a project."""
    return f"{PROXY_ROLE_PREFIX}{_short_id(project_id)}"


def generate_password() -> str:
    """Generate a cryptographically random password."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(PASSWORD_LENGTH))


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def pg_md5_hash(password: str, username: str) -> str:
    """Generate PostgreSQL md5 password hash.

    Format: "md5" + md5(password + username) — PostgreSQL's standard md5 password format.
    """
    raw = (password + username).encode("utf-8")
    return "md5" + hashlib.md5(raw).hexdigest()


def build_create_role_sql(role: str, password: str, connection_limit: int | None = None) -> str:
    """Build a CREATE ROLE statement with proper escaping.

    PostgreSQL DDL (CREATE ROLE) does not support $1 parameter placeholders,
    so we must escape the password literal manually.
    """
    if connection_limit is None:
        connection_limit = get_settings().pg_duckdb_connection_limit
    _validate_ident(role)
    return (
        f"CREATE ROLE {_quote_ident(role)} LOGIN PASSWORD {_quote_literal(password)}"
        f" CONNECTION LIMIT {connection_limit}"
    )


def build_alter_role_password_sql(role: str, password: str) -> str:
    """Build an ALTER ROLE PASSWORD statement with proper escaping."""
    _validate_ident(role)
    return f"ALTER ROLE {_quote_ident(role)} PASSWORD {_quote_literal(password)}"


async def _get_connection(env: ProjectEnvironment) -> asyncpg.Connection:
    """Get an admin connection to a pg_duckdb environment."""
    host = env.internal_host or env.host
    port = env.internal_port if env.internal_host else env.port
    return await asyncpg.connect(
        host=host,
        port=port,
        user=env.admin_user,
        password=env.admin_password,
        database=env.database,
    )


async def ensure_duckdb_role_configured(env: ProjectEnvironment) -> None:
    """Ensure the duckdb_readers group role exists and duckdb.postgres_role GUC is set.

    Idempotent: safe to call on every provision. Creates the group role if it
    doesn't exist, sets the GUC via ALTER SYSTEM, and reloads the config.
    """
    conn = await _get_connection(env)
    try:
        # Create group role if not exists (NOLOGIN — not a real user)
        await conn.execute(
            f"DO $$ BEGIN"
            f"  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {_quote_literal(DUCKDB_READERS_GROUP)}) THEN"
            f"    EXECUTE 'CREATE ROLE {_quote_ident(DUCKDB_READERS_GROUP)} NOLOGIN';"
            f"  END IF;"
            f" END $$"
        )
        await conn.execute(f"ALTER SYSTEM SET duckdb.postgres_role = {_quote_literal(DUCKDB_READERS_GROUP)}")
        await conn.execute("SELECT pg_reload_conf()")
        logger.info("Ensured duckdb_readers role and GUC configured for environment %s", env.environment_id)
    finally:
        await conn.close()


async def create_project_schema(env: ProjectEnvironment, project_id: str, password: str) -> None:
    """Create a schema and read-only role for a project.

    Creates:
    - Schema: project_{short_id}
    - Role: reader_{short_id} with LOGIN, configurable CONNECTION LIMIT, search_path set
    - Revokes public schema access to prevent catalog enumeration

    Args:
        env: ProjectEnvironment to connect to
        project_id: Project UUID
        password: Plaintext password for the role
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))

    conn = await _get_connection(env)
    try:
        await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {_quote_ident(schema)}")
        await conn.execute(build_create_role_sql(role, password))
        await conn.execute(f"GRANT USAGE ON SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}")
        await conn.execute(f"GRANT {_quote_ident(DUCKDB_READERS_GROUP)} TO {_quote_ident(role)}")
        await conn.execute(f"REVOKE ALL ON SCHEMA public FROM {_quote_ident(role)}")
        await conn.execute(f"ALTER ROLE {_quote_ident(role)} SET search_path TO {_quote_ident(schema)}")
        await conn.execute(f"ALTER ROLE {_quote_ident(role)} SET idle_session_timeout = '5min'")
        logger.info("Created schema %s and role %s for project %s", schema, role, project_id)
    finally:
        await conn.close()

    # Create proxy role after internal reader role is ready
    await create_proxy_role(env, project_id, password)


async def drop_project_schema(env: ProjectEnvironment, project_id: str) -> None:
    """Drop a project's schema and role, terminating active connections.

    1. Terminate active connections for the role
    2. DROP SCHEMA CASCADE
    3. DROP ROLE
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))
    proxy = _validate_ident(proxy_role_name(project_id))

    conn = await _get_connection(env)
    try:
        # Terminate active connections for both proxy and internal roles
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
            proxy,
        )
        await conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1",
            role,
        )
        await conn.execute(f"DROP SCHEMA IF EXISTS {_quote_ident(schema)} CASCADE")
        # Drop proxy role before internal reader (proxy depends on reader via GRANT)
        await conn.execute(f"DROP ROLE IF EXISTS {_quote_ident(proxy)}")
        await conn.execute(f"DROP ROLE IF EXISTS {_quote_ident(role)}")
        logger.info("Dropped schema %s, role %s, and proxy %s for project %s", schema, role, proxy, project_id)
    finally:
        await conn.close()


async def regenerate_credentials(env: ProjectEnvironment, project_id: str, new_password: str) -> None:
    """Change the password for a project's reader role.

    Args:
        env: ProjectEnvironment to connect to
        project_id: Project UUID
        new_password: New plaintext password
    """
    role = _validate_ident(role_name(project_id))

    conn = await _get_connection(env)
    try:
        await conn.execute(build_alter_role_password_sql(role, new_password))
        logger.info("Regenerated credentials for role %s", role)
    finally:
        await conn.close()


async def execute_bootstrap(env: ProjectEnvironment, project_id: str, bootstrap_sql: str) -> None:
    """Execute bootstrap SQL to create/update source views in a project's schema.

    The bootstrap SQL is generated by bootstrap_sql.py and contains:
    - Schema creation
    - View cleanup (drop existing)
    - View creation (read_parquet per dataset)

    Executed transactionally via the admin connection.
    """
    conn = await _get_connection(env)
    try:
        await conn.execute(bootstrap_sql)
        logger.info("Executed bootstrap SQL for project %s", project_id)
    finally:
        await conn.close()


async def grant_schema_usage(env: ProjectEnvironment, project_id: str) -> None:
    """Grant USAGE and SELECT on all views in a project's schema to the reader role.

    Called after bootstrap to ensure the reader role can access newly created views.
    """
    schema = _validate_ident(schema_name(project_id))
    role = _validate_ident(role_name(project_id))

    conn = await _get_connection(env)
    try:
        await conn.execute(f"GRANT USAGE ON SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}")
        await conn.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA {_quote_ident(schema)} TO {_quote_ident(role)}")
        logger.info("Granted schema usage to role %s on schema %s", role, schema)
    finally:
        await conn.close()


async def create_proxy_role(env: ProjectEnvironment, project_id: str, password: str) -> None:
    """Create a proxy role with LOGIN and SET ROLE privilege to the internal reader.

    The proxy role is the externally-facing credential. It can SET ROLE to the
    internal reader role, inheriting its schema permissions without directly
    owning any objects.

    Args:
        env: ProjectEnvironment to connect to
        project_id: Project UUID
        password: Plaintext password for the proxy role
    """
    proxy = _validate_ident(proxy_role_name(project_id))
    reader = _validate_ident(role_name(project_id))

    conn = await _get_connection(env)
    try:
        await conn.execute(build_create_role_sql(proxy, password))
        await conn.execute(f"GRANT {_quote_ident(reader)} TO {_quote_ident(proxy)}")
        await conn.execute(
            f"ALTER ROLE {_quote_ident(proxy)} SET search_path TO {_quote_ident(schema_name(project_id))}"
        )
        await conn.execute(f"ALTER ROLE {_quote_ident(proxy)} SET idle_session_timeout = '5min'")
        logger.info("Created proxy role %s with SET ROLE to %s for project %s", proxy, reader, project_id)
    finally:
        await conn.close()


async def regenerate_proxy_credentials(env: ProjectEnvironment, project_id: str, new_password: str) -> None:
    """Change the password for a project's proxy role.

    Args:
        env: ProjectEnvironment to connect to
        project_id: Project UUID
        new_password: New plaintext password
    """
    proxy = _validate_ident(proxy_role_name(project_id))

    conn = await _get_connection(env)
    try:
        await conn.execute(build_alter_role_password_sql(proxy, new_password))
        logger.info("Regenerated credentials for proxy role %s", proxy)
    finally:
        await conn.close()
