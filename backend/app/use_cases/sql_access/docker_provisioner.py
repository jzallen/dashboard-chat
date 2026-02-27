"""Docker-based provisioner for ephemeral pg_duckdb project environments.

Uses aiodocker to manage container lifecycle. Each project gets its own
pg_duckdb container with a dynamic host port mapping.
"""

from __future__ import annotations

import asyncio
import logging

import aiodocker
from aiodocker.exceptions import DockerError

from app.use_cases.sql_access.pg_duckdb_manager import (
    configure_s3_secrets,
    ensure_duckdb_role_configured,
)
from app.use_cases.sql_access.provisioner import (
    EnvironmentStatus,
    ProjectEnvironment,
    ProvisioningError,
    StorageConfig,
)

logger = logging.getLogger(__name__)

CONTAINER_PREFIX = "dashboard-pgduckdb"
HEALTH_CHECK_INTERVAL = 1.0  # seconds between polls
HEALTH_CHECK_TIMEOUT = 30.0  # max wait for container to become healthy


def _container_name(project_id: str) -> str:
    return f"{CONTAINER_PREFIX}-{project_id[:8]}"


class DockerPgDuckDbProvisioner:
    """Manages ephemeral pg_duckdb containers via Docker.

    Each project gets a dedicated container running pgduckdb/pgduckdb.
    The provisioner handles creation, health checking, S3 secret
    configuration, and teardown.
    """

    def __init__(
        self,
        image: str,
        network: str,
        admin_user: str,
        admin_password: str,
        database: str,
        pgbouncer_provisioner=None,
    ) -> None:
        self._image = image
        self._network = network
        self._admin_user = admin_user
        self._admin_password = admin_password
        self._database = database
        self._docker: aiodocker.Docker | None = None
        self._pgbouncer = pgbouncer_provisioner

    async def _get_docker(self) -> aiodocker.Docker:
        if self._docker is None:
            self._docker = aiodocker.Docker()
        return self._docker

    async def close(self) -> None:
        if self._docker is not None:
            await self._docker.close()
            self._docker = None

    async def _ensure_image(self, docker: aiodocker.Docker) -> None:
        """Pull the image if it isn't already available locally."""
        try:
            await docker.images.inspect(self._image)
        except DockerError:
            logger.info("Pulling image %s (this may take a moment)...", self._image)
            await docker.images.pull(self._image)

    async def provision(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        docker = await self._get_docker()
        name = _container_name(project_id)

        # Remove any existing container with same name (idempotent re-provision)
        await self._force_remove(name)

        try:
            # Ensure image is available locally (pull if missing)
            await self._ensure_image(docker)

            config = {
                "Image": self._image,
                "Env": [
                    f"POSTGRES_USER={self._admin_user}",
                    f"POSTGRES_PASSWORD={self._admin_password}",
                    f"POSTGRES_DB={self._database}",
                ],
                "HostConfig": {
                    "PortBindings": {
                        "5432/tcp": [{"HostPort": "0"}],  # auto-assign host port
                    },
                    "NetworkMode": self._network,
                },
            }

            container = await docker.containers.create_or_replace(name, config=config)
            await container.start()

            # Wait for PostgreSQL to accept connections
            host_port = await self._wait_for_healthy(container, name)

            env = ProjectEnvironment(
                environment_id=container.id,
                host="localhost",
                port=host_port,
                database=self._database,
                admin_user=self._admin_user,
                admin_password=self._admin_password,
                internal_host=name,
                internal_port=5432,
            )

            # Configure DuckDB group role GUC, then S3/MinIO secrets
            await ensure_duckdb_role_configured(env)
            await configure_s3_secrets(env, storage_config)

            logger.info(
                "Provisioned pg_duckdb container %s for project %s on port %d",
                name,
                project_id,
                host_port,
            )
            return env

        except ProvisioningError:
            # Clean up on failure
            await self._force_remove(name)
            raise
        except Exception as e:
            await self._force_remove(name)
            raise ProvisioningError(f"Failed to provision environment for project {project_id}: {e}") from e

    async def deprovision(self, project_id: str) -> None:
        name = _container_name(project_id)
        await self._force_remove(name)
        logger.info("Deprovisioned pg_duckdb container %s for project %s", name, project_id)

    async def health_check(self, project_id: str) -> bool:
        docker = await self._get_docker()
        name = _container_name(project_id)
        try:
            container = docker.containers.container(name)
            info = await container.show()
            return info["State"]["Running"]
        except Exception:
            return False

    async def get_environment(self, project_id: str) -> ProjectEnvironment | None:
        docker = await self._get_docker()
        name = _container_name(project_id)
        try:
            container = docker.containers.container(name)
            info = await container.show()
            if not info["State"]["Running"]:
                return None

            port_bindings = info["NetworkSettings"]["Ports"].get("5432/tcp")
            if not port_bindings:
                return None
            host_port = int(port_bindings[0]["HostPort"])

            return ProjectEnvironment(
                environment_id=info["Id"],
                host="localhost",
                port=host_port,
                database=self._database,
                admin_user=self._admin_user,
                admin_password=self._admin_password,
                internal_host=name,
                internal_port=5432,
            )
        except Exception:
            return None

    async def start_environment(self, project_id: str, storage_config: StorageConfig) -> ProjectEnvironment:
        """Start a project environment (provisions pg_duckdb only).

        PgBouncer provisioning is orchestrated by use cases, not here.
        """
        return await self.provision(project_id, storage_config)

    async def stop_environment(self, project_id: str) -> None:
        """Stop and remove the project's pg_duckdb environment."""
        await self.deprovision(project_id)

    async def get_detailed_status(self, project_id: str) -> EnvironmentStatus:
        """Get detailed status checking both pg_duckdb and PgBouncer components."""
        pgduckdb_running = await self.health_check(project_id)

        pgbouncer_running = False
        if self._pgbouncer is not None:
            pgbouncer_running = await self._pgbouncer.health_check(project_id)

        if pgduckdb_running and pgbouncer_running:
            status = "running"
            message = None
        elif pgduckdb_running and not pgbouncer_running:
            status = "degraded"
            message = "pg_duckdb running but PgBouncer is not available"
        elif not pgduckdb_running and pgbouncer_running:
            status = "degraded"
            message = "PgBouncer running but pg_duckdb is not available"
        else:
            status = "stopped"
            message = None

        return EnvironmentStatus(
            pgduckdb_running=pgduckdb_running,
            pgbouncer_running=pgbouncer_running,
            status=status,
            message=message,
        )

    async def _wait_for_healthy(self, container: aiodocker.containers.DockerContainer, name: str) -> int:
        elapsed = 0.0
        while elapsed < HEALTH_CHECK_TIMEOUT:
            info = await container.show()
            if not info["State"]["Running"]:
                raise ProvisioningError(f"Container {info['Name']} exited during health check")

            port_bindings = info["NetworkSettings"]["Ports"].get("5432/tcp")
            if port_bindings:
                host_port = int(port_bindings[0]["HostPort"])
                # Health-check via the Docker network (container name on
                # internal port) so this works from inside another container.
                try:
                    _reader, writer = await asyncio.wait_for(
                        asyncio.open_connection(name, 5432),
                        timeout=2.0,
                    )
                    writer.close()
                    await writer.wait_closed()
                    return host_port
                except (TimeoutError, ConnectionRefusedError, OSError):
                    pass

            await asyncio.sleep(HEALTH_CHECK_INTERVAL)
            elapsed += HEALTH_CHECK_INTERVAL

        raise ProvisioningError(f"Container did not become healthy within {HEALTH_CHECK_TIMEOUT}s")

    async def _force_remove(self, name: str) -> None:
        docker = await self._get_docker()
        try:
            container = docker.containers.container(name)
            await container.kill()
        except Exception:
            pass
        try:
            container = docker.containers.container(name)
            await container.delete(force=True)
        except Exception:
            pass
