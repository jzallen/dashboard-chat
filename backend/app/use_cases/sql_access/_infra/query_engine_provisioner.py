"""Query engine provisioner implementation using asyncpg.

Connects to shared pg_duckdb engine nodes and manages per-project schemas,
roles, and views via the pg_duckdb_manager functions.
"""

from __future__ import annotations

import logging

import asyncpg

from . import pg_duckdb_manager as mgr
from .provisioner import ProjectEnvironment

logger = logging.getLogger(__name__)


class AsyncpgQueryEngineProvisioner:
    """QueryEngineProvisioner implementation backed by asyncpg.

    Resolves engine_node_id to connection details via a lookup function,
    then delegates DDL operations to pg_duckdb_manager.
    """

    def __init__(
        self,
        node_lookup: callable,
    ) -> None:
        """Initialize the provisioner.

        Args:
            node_lookup: Async callable that takes an engine_node_id and returns
                a dict with keys: host, port, database, admin_user, admin_password.
                Raises KeyError if the node is not found.
        """
        self._node_lookup = node_lookup

    async def _get_env(self, engine_node_id: str) -> ProjectEnvironment:
        """Look up engine node and build a ProjectEnvironment for pg_duckdb_manager."""
        node = await self._node_lookup(engine_node_id)
        return ProjectEnvironment(
            environment_id=engine_node_id,
            host=node["host"],
            port=node["port"],
            database=node["database"],
            admin_user=node["admin_user"],
            admin_password=node["admin_password"],
        )

    async def create_project_access(self, engine_node_id: str, project_id: str, password: str) -> dict:
        """Create schema, internal reader role, and proxy role for a project.

        Delegates to pg_duckdb_manager.create_project_schema (which now also
        creates the proxy role internally).

        Returns dict with keys: pg_schema, pg_role, pg_proxy_role.
        """
        env = await self._get_env(engine_node_id)
        await mgr.create_project_schema(env, project_id, password)
        return {
            "pg_schema": mgr.schema_name(project_id),
            "pg_role": mgr.role_name(project_id),
            "pg_proxy_role": mgr.proxy_role_name(project_id),
        }

    async def drop_project_access(self, engine_node_id: str, project_id: str) -> None:
        """Drop schema, roles, and terminate connections for a project."""
        env = await self._get_env(engine_node_id)
        await mgr.drop_project_schema(env, project_id)

    async def sync_views(self, engine_node_id: str, project_id: str, bootstrap_sql: str) -> None:
        """Execute bootstrap SQL and grant schema usage to the reader role."""
        env = await self._get_env(engine_node_id)
        await mgr.execute_bootstrap(env, project_id, bootstrap_sql)
        await mgr.grant_schema_usage(env, project_id)

    async def health_check(self, engine_node_id: str) -> bool:
        """Check if the engine node is reachable by attempting a simple query."""
        try:
            env = await self._get_env(engine_node_id)
            conn = await asyncpg.connect(
                host=env.host,
                port=env.port,
                user=env.admin_user,
                password=env.admin_password,
                database=env.database,
                timeout=5.0,
            )
            try:
                await conn.execute("SELECT 1")
                return True
            finally:
                await conn.close()
        except Exception:
            logger.warning("Health check failed for engine node %s", engine_node_id, exc_info=True)
            return False
