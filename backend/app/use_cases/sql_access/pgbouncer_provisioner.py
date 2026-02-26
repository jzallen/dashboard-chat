"""Docker-based provisioner for PgBouncer proxy containers.

Uses aiodocker to manage PgBouncer container lifecycle. Each project gets
its own PgBouncer sidecar for stable credential proxying to pg_duckdb.
"""

from __future__ import annotations

import asyncio
import logging

import aiodocker
from aiodocker.exceptions import DockerError

from app.config import get_settings

logger = logging.getLogger(__name__)

CONTAINER_PREFIX = "dashboard-pgbouncer"
HEALTH_CHECK_INTERVAL = 0.5
HEALTH_CHECK_TIMEOUT = 10.0


def _container_name(project_id: str) -> str:
    return f"{CONTAINER_PREFIX}-{project_id[:8]}"


class DockerPgBouncerProvisioner:
    """Manages PgBouncer proxy containers via Docker."""

    def __init__(self, image: str, network: str) -> None:
        self._image = image
        self._network = network
        self._docker: aiodocker.Docker | None = None

    async def _get_docker(self) -> aiodocker.Docker:
        if self._docker is None:
            self._docker = aiodocker.Docker()
        return self._docker

    async def close(self) -> None:
        if self._docker is not None:
            await self._docker.close()
            self._docker = None

    async def _ensure_image(self, docker: aiodocker.Docker) -> None:
        try:
            await docker.images.inspect(self._image)
        except DockerError:
            logger.info("Pulling PgBouncer image %s...", self._image)
            await docker.images.pull(self._image)

    async def provision(
        self,
        project_id: str,
        proxy_port: int,
        md5_hash: str,
        upstream_host: str,
        auth_user: str,
    ) -> str:
        """Create and start a PgBouncer container.

        Args:
            project_id: Project UUID
            proxy_port: Host port to bind (stable, from port allocation)
            md5_hash: PostgreSQL md5 hash for auth_file
            upstream_host: pg_duckdb container hostname (Docker network name)
            auth_user: Username for authentication (e.g., "reader_a1b2c3d4")

        Returns:
            Container ID
        """
        docker = await self._get_docker()
        name = _container_name(project_id)

        # Remove existing container if any
        await self._force_remove(name)

        try:
            await self._ensure_image(docker)
            settings = get_settings()

            config = {
                "Image": self._image,
                "Env": [
                    f"DB_HOST={upstream_host}",
                    "DB_PORT=5432",
                    f"DB_NAME={settings.pg_duckdb_database}",
                    f"AUTH_USER={auth_user}",
                    f"AUTH_PASSWORD_HASH={md5_hash}",
                    "LISTEN_PORT=6432",
                    "POOL_MODE=session",
                    f"MAX_CLIENT_CONN={settings.pgbouncer_max_client_conn}",
                    f"DEFAULT_POOL_SIZE={settings.pgbouncer_default_pool_size}",
                    "LOG_CONNECTIONS=1",
                    "LOG_DISCONNECTIONS=1",
                ],
                "HostConfig": {
                    "PortBindings": {
                        "6432/tcp": [{"HostPort": str(proxy_port)}],
                    },
                    "NetworkMode": self._network,
                },
            }

            container = await docker.containers.create_or_replace(name, config=config)
            await container.start()

            # Wait for PgBouncer to be ready (TCP connect check)
            await self._wait_for_healthy(name)

            logger.info(
                "Provisioned PgBouncer container %s for project %s on port %d",
                name,
                project_id,
                proxy_port,
            )
            return container.id

        except Exception as e:
            await self._force_remove(name)
            raise RuntimeError(
                f"Failed to provision PgBouncer for project {project_id}: {e}"
            ) from e

    async def deprovision(self, project_id: str) -> None:
        name = _container_name(project_id)
        await self._force_remove(name)
        logger.info("Deprovisioned PgBouncer container %s", name)

    async def health_check(self, project_id: str) -> bool:
        docker = await self._get_docker()
        name = _container_name(project_id)
        try:
            container = docker.containers.container(name)
            info = await container.show()
            return info["State"]["Running"]
        except Exception:
            return False

    async def recreate(
        self,
        project_id: str,
        proxy_port: int,
        md5_hash: str,
        upstream_host: str,
        auth_user: str,
    ) -> str:
        """Recreate PgBouncer with updated config (same port binding).

        Used for credential rotation and upstream changes.
        """
        await self.deprovision(project_id)
        return await self.provision(
            project_id, proxy_port, md5_hash, upstream_host, auth_user
        )

    async def _wait_for_healthy(self, name: str) -> None:
        elapsed = 0.0
        while elapsed < HEALTH_CHECK_TIMEOUT:
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(name, 6432),
                    timeout=2.0,
                )
                writer.close()
                await writer.wait_closed()
                return
            except (ConnectionRefusedError, asyncio.TimeoutError, OSError):
                pass
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)
            elapsed += HEALTH_CHECK_INTERVAL
        raise RuntimeError(
            f"PgBouncer container {name} did not become healthy "
            f"within {HEALTH_CHECK_TIMEOUT}s"
        )

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
