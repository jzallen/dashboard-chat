"""Provisioner abstraction for ephemeral pg_duckdb project environments."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ProjectEnvironment:
    """Connection info for a provisioned project SQL environment."""

    environment_id: str  # Opaque infra ID (Docker container ID, ECS task ARN, etc.)
    host: str  # Connection host (localhost for Docker, hostname for cloud)
    port: int  # Mapped port for connections
    database: str  # Database name ("dashboard_external")
    admin_user: str  # Admin role for DDL operations
    admin_password: str  # Admin password


@dataclass(frozen=True)
class StorageConfig:
    """S3/MinIO storage configuration for pg_duckdb environments."""

    endpoint: str  # "minio:9000" (internal) or S3 endpoint
    access_key: str
    secret_key: str
    region: str
    url_style: str  # "path" for MinIO, "vhost" for S3
    use_ssl: bool


class ProvisioningError(Exception):
    """Raised when environment provisioning fails."""

    pass


class ProjectEnvironmentProvisioner(Protocol):
    """Protocol for managing ephemeral project SQL environments."""

    async def provision(
        self, project_id: str, storage_config: StorageConfig
    ) -> ProjectEnvironment:
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


# ---------------------------------------------------------------------------
# App-level provisioner accessor (set during startup, read by use cases)
# ---------------------------------------------------------------------------

_app_provisioner: ProjectEnvironmentProvisioner | None = None


def set_app_provisioner(provisioner: ProjectEnvironmentProvisioner) -> None:
    global _app_provisioner
    _app_provisioner = provisioner


def get_app_provisioner() -> ProjectEnvironmentProvisioner:
    if _app_provisioner is None:
        raise RuntimeError(
            "Provisioner not configured. Call set_app_provisioner() during startup."
        )
    return _app_provisioner


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
        self._environments: dict[str, ProjectEnvironment] = {}
        self._healthy: bool = True

    async def provision(
        self, project_id: str, storage_config: StorageConfig
    ) -> ProjectEnvironment:
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

    def set_healthy(self, healthy: bool) -> None:
        """Test helper: control health check responses."""
        self._healthy = healthy
