"""Provisioner abstractions for pg_duckdb project environments.

Contains data classes for environment configuration and the
QueryEngineProvisioner protocol that targets shared, org-level
query engine nodes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ProjectEnvironment:
    """Connection info for a provisioned project SQL environment."""

    environment_id: str  # Opaque infra ID (Docker container ID, ECS task ARN, etc.)
    host: str  # External connection host (localhost for Docker, hostname for cloud)
    port: int  # External mapped port for connections
    database: str  # Database name ("dashboard_external")
    admin_user: str  # Admin role for DDL operations
    admin_password: str
    internal_host: str = ""  # Docker-network reachable host (container name)
    internal_port: int = 5432  # Internal container port
    proxy_container_id: str = ""  # PgBouncer container ID


@dataclass(frozen=True)
class StorageConfig:
    """S3/MinIO storage configuration for pg_duckdb environments."""

    endpoint: str  # "minio:9000" (internal) or S3 endpoint
    access_key: str
    secret_key: str
    region: str
    url_style: str  # "path" for MinIO, "vhost" for S3
    use_ssl: bool


@dataclass(frozen=True)
class EnvironmentStatus:
    """Detailed status of a project's SQL access environment."""

    pgduckdb_running: bool
    pgbouncer_running: bool
    status: str  # "running" | "stopped" | "degraded" | "provisioning" | "error"
    message: str | None = None


class ProvisioningError(Exception):
    """Raised when environment provisioning fails."""

    pass


# ---------------------------------------------------------------------------
# Query Engine Provisioner — shared org-level engine node protocol
# ---------------------------------------------------------------------------


class QueryEngineProvisioner(Protocol):
    """Protocol for managing project access on shared query engine nodes.

    Targets a shared pg_duckdb instance identified by engine_node_id.
    """

    async def create_project_access(self, engine_node_id: str, project_id: str, password: str) -> dict:
        """Create schema, internal reader role, and proxy role for a project.

        Returns dict with keys: pg_schema, pg_role, pg_proxy_role.
        """
        ...

    async def drop_project_access(self, engine_node_id: str, project_id: str) -> None:
        """Drop schema, roles, and terminate connections for a project."""
        ...

    async def sync_views(self, engine_node_id: str, project_id: str, bootstrap_sql: str) -> None:
        """Execute bootstrap SQL and grant schema usage to the reader role."""
        ...

    async def health_check(self, engine_node_id: str) -> bool:
        """Check if the engine node is reachable and accepting connections."""
        ...


# ---------------------------------------------------------------------------
# App-level query engine provisioner accessor
# ---------------------------------------------------------------------------

_app_query_engine_provisioner: QueryEngineProvisioner | None = None


def set_app_query_engine_provisioner(provisioner: QueryEngineProvisioner) -> None:
    global _app_query_engine_provisioner
    _app_query_engine_provisioner = provisioner


def get_app_query_engine_provisioner() -> QueryEngineProvisioner:
    if _app_query_engine_provisioner is None:
        raise RuntimeError(
            "QueryEngineProvisioner not configured. Call set_app_query_engine_provisioner() during startup."
        )
    return _app_query_engine_provisioner


# ---------------------------------------------------------------------------
# Mock query engine provisioner for testing
# ---------------------------------------------------------------------------


class MockQueryEngineProvisioner:
    """Test provisioner for QueryEngineProvisioner protocol."""

    def __init__(self) -> None:
        self.create_calls: list[tuple[str, str, str]] = []
        self.drop_calls: list[tuple[str, str]] = []
        self.sync_calls: list[tuple[str, str, str]] = []
        self.health_check_calls: list[str] = []
        self._healthy: bool = True

    async def create_project_access(self, engine_node_id: str, project_id: str, password: str) -> dict:
        from .pg_duckdb_manager import proxy_role_name, role_name, schema_name

        self.create_calls.append((engine_node_id, project_id, password))
        return {
            "pg_schema": schema_name(project_id),
            "pg_role": role_name(project_id),
            "pg_proxy_role": proxy_role_name(project_id),
        }

    async def drop_project_access(self, engine_node_id: str, project_id: str) -> None:
        self.drop_calls.append((engine_node_id, project_id))

    async def sync_views(self, engine_node_id: str, project_id: str, bootstrap_sql: str) -> None:
        self.sync_calls.append((engine_node_id, project_id, bootstrap_sql))

    async def health_check(self, engine_node_id: str) -> bool:
        self.health_check_calls.append(engine_node_id)
        return self._healthy

    def set_healthy(self, healthy: bool) -> None:
        """Test helper: control health check responses."""
        self._healthy = healthy
