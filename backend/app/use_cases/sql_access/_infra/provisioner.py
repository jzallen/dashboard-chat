"""Provisioner abstraction for ephemeral pg_duckdb project environments."""

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


class ProjectEnvironmentProvisioner(Protocol):
    """Protocol for managing ephemeral project SQL environments."""

    async def provision(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        """Provision a project SQL environment.

        Waits for health check. Configures storage secrets.
        Raises ProvisioningError on failure.
        """
        ...

    async def deprovision(self, project_id: str) -> None:
        """Tear down the project's SQL environment.

        Idempotent -- no error if environment doesn't exist.
        """
        ...

    async def health_check(self, project_id: str) -> bool:
        """Check if the project's environment is running and accepting connections."""
        ...

    async def get_environment(self, project_id: str) -> ProjectEnvironment | None:
        """Get connection info for a running environment. None if not running."""
        ...

    async def start_environment(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        """Start (provision) an environment. Alias for provision with lifecycle semantics."""
        ...

    async def stop_environment(self, project_id: str) -> None:
        """Stop and remove the project's environment."""
        ...

    async def get_detailed_status(self, project_id: str) -> EnvironmentStatus:
        """Get detailed status of all environment components."""
        ...


# ---------------------------------------------------------------------------
# App-level provisioner accessor (set during startup, read by use cases)
# ---------------------------------------------------------------------------

_app_provisioner: ProjectEnvironmentProvisioner | None = None


def set_app_provisioner(provisioner: ProjectEnvironmentProvisioner) -> None:
    global _app_provisioner
    _app_provisioner = provisioner


def get_app_provisioner() -> ProjectEnvironmentProvisioner:
    if _app_provisioner is None:
        raise RuntimeError("Provisioner not configured. Call set_app_provisioner() during startup.")
    return _app_provisioner


# ---------------------------------------------------------------------------
# App-level PgBouncer provisioner accessor
# ---------------------------------------------------------------------------

_app_pgbouncer_provisioner = None


def set_app_pgbouncer_provisioner(provisioner) -> None:
    global _app_pgbouncer_provisioner
    _app_pgbouncer_provisioner = provisioner


def get_app_pgbouncer_provisioner():
    if _app_pgbouncer_provisioner is None:
        raise RuntimeError("PgBouncer provisioner not configured.")
    return _app_pgbouncer_provisioner


# ---------------------------------------------------------------------------
# Mock provisioners for testing
# ---------------------------------------------------------------------------


class MockEnvironmentProvisioner:
    """Test provisioner that tracks calls without managing real infrastructure."""

    def __init__(
        self,
        default_env: ProjectEnvironment | None = None,
    ) -> None:
        self._default_env = default_env or ProjectEnvironment(
            environment_id="mock-container-id",
            host="localhost",
            port=15432,
            database="dashboard_external",
            admin_user="duckdb_admin",
            admin_password="duckdb_secret",
        )
        self.provision_calls: list[tuple[str, StorageConfig]] = []
        self.deprovision_calls: list[str] = []
        self.health_check_calls: list[str] = []
        self.start_environment_calls: list[tuple[str, StorageConfig]] = []
        self.stop_environment_calls: list[str] = []
        self._environments: dict[str, ProjectEnvironment] = {}
        self._healthy: bool = True

    async def provision(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        self.provision_calls.append((project_id, storage_config))
        env = ProjectEnvironment(
            environment_id=f"mock-{project_id[:8]}",
            host=self._default_env.host,
            port=self._default_env.port,
            database=self._default_env.database,
            admin_user=self._default_env.admin_user,
            admin_password=self._default_env.admin_password,
        )
        self._environments[project_id] = env
        return env

    async def deprovision(self, project_id: str) -> None:
        self.deprovision_calls.append(project_id)
        self._environments.pop(project_id, None)

    async def health_check(self, project_id: str) -> bool:
        self.health_check_calls.append(project_id)
        return self._healthy and project_id in self._environments

    async def get_environment(self, project_id: str) -> ProjectEnvironment | None:
        return self._environments.get(project_id)

    async def start_environment(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        self.start_environment_calls.append((project_id, storage_config))
        env = await self.provision(project_id, storage_config)
        return env

    async def stop_environment(self, project_id: str) -> None:
        self.stop_environment_calls.append(project_id)
        self._environments.pop(project_id, None)

    async def get_detailed_status(self, project_id: str) -> EnvironmentStatus:
        is_provisioned = project_id in self._environments
        return EnvironmentStatus(
            pgduckdb_running=is_provisioned and self._healthy,
            pgbouncer_running=is_provisioned,
            status="running" if (is_provisioned and self._healthy) else "stopped",
            message=None,
        )

    def set_healthy(self, healthy: bool) -> None:
        """Test helper: control health check responses."""
        self._healthy = healthy


class MockPgBouncerProvisioner:
    """Test PgBouncer provisioner that tracks calls without managing real containers."""

    def __init__(self) -> None:
        self.provision_calls: list[dict] = []
        self.deprovision_calls: list[str] = []
        self.recreate_calls: list[dict] = []
        self.health_check_calls: list[str] = []
        self._healthy: bool = True
        self._should_fail: bool = False

    async def provision(
        self,
        project_id: str,
        proxy_port: int,
        md5_hash: str,
        upstream_host: str,
        auth_user: str,
    ) -> str:
        if self._should_fail:
            raise RuntimeError("Mock PgBouncer provision failure")
        self.provision_calls.append(
            {
                "project_id": project_id,
                "proxy_port": proxy_port,
                "md5_hash": md5_hash,
                "upstream_host": upstream_host,
                "auth_user": auth_user,
            }
        )
        return f"mock-pgbouncer-{project_id[:8]}"

    async def deprovision(self, project_id: str) -> None:
        self.deprovision_calls.append(project_id)

    async def health_check(self, project_id: str) -> bool:
        self.health_check_calls.append(project_id)
        return self._healthy

    async def recreate(
        self,
        project_id: str,
        proxy_port: int,
        md5_hash: str,
        upstream_host: str,
        auth_user: str,
    ) -> str:
        if self._should_fail:
            raise RuntimeError("Mock PgBouncer recreate failure")
        self.recreate_calls.append(
            {
                "project_id": project_id,
                "proxy_port": proxy_port,
                "md5_hash": md5_hash,
                "upstream_host": upstream_host,
                "auth_user": auth_user,
            }
        )
        return f"mock-pgbouncer-{project_id[:8]}"

    def set_healthy(self, healthy: bool) -> None:
        self._healthy = healthy

    def set_should_fail(self, should_fail: bool) -> None:
        self._should_fail = should_fail
