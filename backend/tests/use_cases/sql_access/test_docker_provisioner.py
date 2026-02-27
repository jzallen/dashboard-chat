"""Tests for DockerPgDuckDbProvisioner using mocked aiodocker."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.use_cases.sql_access._infra import (
    ProjectEnvironment,
    ProvisioningError,
    StorageConfig,
)
from app.use_cases.sql_access._infra.docker_provisioner import (
    CONTAINER_PREFIX,
    DockerPgDuckDbProvisioner,
    _container_name,
)

PROJECT_ID = "proj-abc12345-def6-7890"
CONTAINER_NAME = f"{CONTAINER_PREFIX}-{PROJECT_ID[:8]}"

STORAGE_CONFIG = StorageConfig(
    endpoint="minio:9000",
    access_key="minioadmin",
    secret_key="minioadmin",
    region="us-east-1",
    url_style="path",
    use_ssl=False,
)

IMAGE = "pgduckdb/pgduckdb:16-main"
NETWORK = "dashboard-chat_default"
ADMIN_USER = "duckdb_admin"
ADMIN_PASSWORD = "duckdb_secret"
DATABASE = "dashboard_external"


def _make_provisioner() -> DockerPgDuckDbProvisioner:
    return DockerPgDuckDbProvisioner(
        image=IMAGE,
        network=NETWORK,
        admin_user=ADMIN_USER,
        admin_password=ADMIN_PASSWORD,
        database=DATABASE,
    )


def _mock_container(
    container_id: str = "abc123containerid",
    running: bool = True,
    host_port: str = "15432",
) -> MagicMock:
    """Create a mock container with show() returning realistic inspect data."""
    container = MagicMock()
    container.id = container_id
    container.start = AsyncMock()
    container.kill = AsyncMock()
    container.delete = AsyncMock()
    container.show = AsyncMock(
        return_value={
            "Id": container_id,
            "Name": f"/{CONTAINER_NAME}",
            "State": {"Running": running},
            "NetworkSettings": {
                "Ports": {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": host_port}] if host_port else None}
            },
        }
    )
    return container


def _mock_docker(container: MagicMock | None = None) -> MagicMock:
    """Create a mock aiodocker.Docker client."""
    docker = MagicMock()
    docker.close = AsyncMock()

    if container is None:
        container = _mock_container()

    docker.containers.create_or_replace = AsyncMock(return_value=container)
    # containers.container() returns the container mock for name-based access
    docker.containers.container = MagicMock(return_value=container)
    # images.inspect succeeds → _ensure_image treats the image as already pulled
    docker.images.inspect = AsyncMock()

    return docker


class TestContainerName:
    def test_uses_prefix_and_truncated_project_id(self):
        assert _container_name(PROJECT_ID) == CONTAINER_NAME

    def test_truncates_to_8_chars(self):
        assert _container_name("abcdefghijklmnop") == f"{CONTAINER_PREFIX}-abcdefgh"


def _mock_open_connection():
    """Return an AsyncMock for asyncio.open_connection that yields a mock reader/writer."""
    writer = MagicMock()
    writer.close = MagicMock()
    writer.wait_closed = AsyncMock()
    reader = MagicMock()
    mock = AsyncMock(return_value=(reader, writer))
    return mock


class TestProvision:
    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_creates_container_and_returns_environment(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        mock_open_conn.side_effect = _mock_open_connection().side_effect
        mock_open_conn.return_value = _mock_open_connection().return_value
        # Make open_connection succeed immediately
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        mock_open_conn.return_value = (MagicMock(), writer)

        container = _mock_container()
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        assert isinstance(env, ProjectEnvironment)
        assert env.environment_id == container.id
        assert env.host == "localhost"
        assert env.port == 15432
        assert env.database == DATABASE
        assert env.admin_user == ADMIN_USER
        assert env.admin_password == ADMIN_PASSWORD

        # Container was created and started
        docker.containers.create_or_replace.assert_awaited_once()
        container.start.assert_awaited_once()

    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_configures_s3_secrets(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        mock_open_conn.return_value = (MagicMock(), writer)

        container = _mock_container()
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        mock_configure_s3.assert_awaited_once_with(env, STORAGE_CONFIG)

    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_ensure_duckdb_role_called_before_s3_secrets(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        """ensure_duckdb_role_configured is called after health check, before configure_s3_secrets."""
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        mock_open_conn.return_value = (MagicMock(), writer)

        container = _mock_container()
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        # Track call order
        call_order = []
        mock_ensure_role.side_effect = lambda env: call_order.append("ensure_role")
        mock_configure_s3.side_effect = lambda env, sc: call_order.append("configure_s3")

        provisioner = _make_provisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        mock_ensure_role.assert_awaited_once()
        mock_configure_s3.assert_awaited_once()
        assert call_order == ["ensure_role", "configure_s3"]

    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_removes_old_container_before_creating(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        """Provision is idempotent: removes existing container first."""
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        mock_open_conn.return_value = (MagicMock(), writer)

        old_container = _mock_container()
        docker = _mock_docker(old_container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        # _force_remove called before create: kill + delete on old container
        old_container.kill.assert_awaited()
        old_container.delete.assert_awaited()

    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_cleans_up_on_failure(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        """If configure_s3_secrets fails, container is force-removed."""
        writer = MagicMock()
        writer.close = MagicMock()
        writer.wait_closed = AsyncMock()
        mock_open_conn.return_value = (MagicMock(), writer)

        container = _mock_container()
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        mock_configure_s3.side_effect = Exception("S3 config failed")

        provisioner = _make_provisioner()
        with pytest.raises(ProvisioningError, match="Failed to provision"):
            await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        # Force remove called during cleanup (kill + delete)
        assert container.kill.await_count >= 2  # once in pre-remove, once in cleanup
        assert container.delete.await_count >= 2

    @patch("asyncio.sleep", new_callable=AsyncMock)
    @patch("asyncio.open_connection")
    @patch("app.use_cases.sql_access._infra.docker_provisioner.configure_s3_secrets", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.ensure_duckdb_role_configured", new_callable=AsyncMock)
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_propagates_provisioning_error(
        self, mock_docker_cls, mock_ensure_role, mock_configure_s3, mock_open_conn, mock_sleep
    ):
        """ProvisioningError from health check is re-raised directly."""
        container = _mock_container(running=False)
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        # Container shows not running -- _wait_for_healthy raises ProvisioningError
        provisioner = _make_provisioner()
        with pytest.raises(ProvisioningError, match="exited during health check"):
            await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)


class TestDeprovision:
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_stops_and_removes_container(self, mock_docker_cls):
        container = _mock_container()
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        await provisioner.deprovision(PROJECT_ID)

        container.kill.assert_awaited()
        container.delete.assert_awaited()

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_idempotent_when_container_missing(self, mock_docker_cls):
        """Deprovision does not raise if container doesn't exist."""
        docker = MagicMock()
        docker.close = AsyncMock()
        container = MagicMock()
        container.kill = AsyncMock(side_effect=Exception("No such container"))
        container.delete = AsyncMock(side_effect=Exception("No such container"))
        docker.containers.container = MagicMock(return_value=container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        # Should not raise
        await provisioner.deprovision(PROJECT_ID)


class TestHealthCheck:
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_true_when_running(self, mock_docker_cls):
        container = _mock_container(running=True)
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        result = await provisioner.health_check(PROJECT_ID)
        assert result is True

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_false_when_not_running(self, mock_docker_cls):
        container = _mock_container(running=False)
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        result = await provisioner.health_check(PROJECT_ID)
        assert result is False

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_false_when_container_missing(self, mock_docker_cls):
        docker = MagicMock()
        docker.close = AsyncMock()
        container = MagicMock()
        container.show = AsyncMock(side_effect=Exception("No such container"))
        docker.containers.container = MagicMock(return_value=container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        result = await provisioner.health_check(PROJECT_ID)
        assert result is False


class TestGetEnvironment:
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_environment_when_running(self, mock_docker_cls):
        container = _mock_container(container_id="real-id-123", host_port="25432")
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.get_environment(PROJECT_ID)

        assert env is not None
        assert env.environment_id == "real-id-123"
        assert env.host == "localhost"
        assert env.port == 25432
        assert env.database == DATABASE
        assert env.admin_user == ADMIN_USER

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_none_when_not_running(self, mock_docker_cls):
        container = _mock_container(running=False)
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.get_environment(PROJECT_ID)
        assert env is None

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_none_when_container_missing(self, mock_docker_cls):
        docker = MagicMock()
        docker.close = AsyncMock()
        container = MagicMock()
        container.show = AsyncMock(side_effect=Exception("No such container"))
        docker.containers.container = MagicMock(return_value=container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.get_environment(PROJECT_ID)
        assert env is None

    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_returns_none_when_no_port_bindings(self, mock_docker_cls):
        container = _mock_container(host_port="")
        # Override show to return no port bindings
        container.show = AsyncMock(
            return_value={
                "Id": "some-id",
                "State": {"Running": True},
                "NetworkSettings": {"Ports": {"5432/tcp": None}},
            }
        )
        docker = _mock_docker(container)
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        env = await provisioner.get_environment(PROJECT_ID)
        assert env is None


class TestClose:
    @patch("app.use_cases.sql_access._infra.docker_provisioner.aiodocker.Docker")
    async def test_closes_docker_session(self, mock_docker_cls):
        docker = _mock_docker()
        mock_docker_cls.return_value = docker

        provisioner = _make_provisioner()
        # Force initialization of docker client
        await provisioner.health_check(PROJECT_ID)

        await provisioner.close()
        docker.close.assert_awaited_once()

    async def test_close_is_noop_when_not_initialized(self):
        provisioner = _make_provisioner()
        # Should not raise
        await provisioner.close()
