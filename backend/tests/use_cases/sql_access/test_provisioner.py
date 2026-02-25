"""Tests for provisioner abstraction types and MockEnvironmentProvisioner."""

from app.use_cases.sql_access.provisioner import (
    MockEnvironmentProvisioner,
    ProjectEnvironment,
    ProvisioningError,
    StorageConfig,
)

STORAGE_CONFIG = StorageConfig(
    endpoint="minio:9000",
    access_key="minioadmin",
    secret_key="minioadmin",
    region="us-east-1",
    url_style="path",
    use_ssl=False,
)

PROJECT_ID = "proj-abc12345-def6-7890"


class TestProjectEnvironment:

    def test_is_frozen(self):
        env = ProjectEnvironment(
            environment_id="test",
            host="localhost",
            port=5432,
            database="db",
            admin_user="admin",
            admin_password="pass",
        )
        try:
            env.host = "other"  # type: ignore[misc]
            assert False, "Should have raised FrozenInstanceError"
        except AttributeError:
            pass


class TestStorageConfig:

    def test_is_frozen(self):
        config = StorageConfig(
            endpoint="minio:9000",
            access_key="key",
            secret_key="secret",
            region="us-east-1",
            url_style="path",
            use_ssl=False,
        )
        try:
            config.endpoint = "other"  # type: ignore[misc]
            assert False, "Should have raised FrozenInstanceError"
        except AttributeError:
            pass


class TestProvisioningError:

    def test_is_exception_subclass(self):
        assert issubclass(ProvisioningError, Exception)
        error = ProvisioningError("container failed to start")
        assert str(error) == "container failed to start"
        assert isinstance(error, Exception)


class TestMockEnvironmentProvisioner:

    async def test_provision_returns_project_environment(self):
        provisioner = MockEnvironmentProvisioner()
        env = await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        assert isinstance(env, ProjectEnvironment)
        assert env.environment_id == f"mock-{PROJECT_ID[:8]}"
        assert env.host == "localhost"
        assert env.port == 15432
        assert env.database == "dashboard_external"
        assert env.admin_user == "duckdb_admin"
        assert env.admin_password == "duckdb_secret"

    async def test_provision_with_custom_default_env(self):
        custom_env = ProjectEnvironment(
            environment_id="custom-id",
            host="custom-host",
            port=25432,
            database="custom_db",
            admin_user="custom_admin",
            admin_password="custom_pass",
        )
        provisioner = MockEnvironmentProvisioner(default_env=custom_env)
        env = await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        assert env.host == "custom-host"
        assert env.port == 25432
        assert env.database == "custom_db"

    async def test_deprovision_is_idempotent(self):
        provisioner = MockEnvironmentProvisioner()
        # Deprovision without prior provision -- should not raise
        await provisioner.deprovision(PROJECT_ID)
        await provisioner.deprovision(PROJECT_ID)
        assert provisioner.deprovision_calls == [PROJECT_ID, PROJECT_ID]

    async def test_deprovision_removes_environment(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)
        assert await provisioner.get_environment(PROJECT_ID) is not None

        await provisioner.deprovision(PROJECT_ID)
        assert await provisioner.get_environment(PROJECT_ID) is None

    async def test_health_check_true_after_provision(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)
        assert await provisioner.health_check(PROJECT_ID) is True

    async def test_health_check_false_when_not_provisioned(self):
        provisioner = MockEnvironmentProvisioner()
        assert await provisioner.health_check(PROJECT_ID) is False

    async def test_health_check_false_after_deprovision(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)
        await provisioner.deprovision(PROJECT_ID)
        assert await provisioner.health_check(PROJECT_ID) is False

    async def test_health_check_respects_set_healthy(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)

        provisioner.set_healthy(False)
        assert await provisioner.health_check(PROJECT_ID) is False

        provisioner.set_healthy(True)
        assert await provisioner.health_check(PROJECT_ID) is True

    async def test_get_environment_returns_none_when_not_provisioned(self):
        provisioner = MockEnvironmentProvisioner()
        assert await provisioner.get_environment(PROJECT_ID) is None

    async def test_get_environment_returns_env_after_provision(self):
        provisioner = MockEnvironmentProvisioner()
        env = await provisioner.provision(PROJECT_ID, STORAGE_CONFIG)
        retrieved = await provisioner.get_environment(PROJECT_ID)
        assert retrieved == env

    async def test_tracks_provision_calls(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.provision("proj-1", STORAGE_CONFIG)
        await provisioner.provision("proj-2", STORAGE_CONFIG)

        assert len(provisioner.provision_calls) == 2
        assert provisioner.provision_calls[0] == ("proj-1", STORAGE_CONFIG)
        assert provisioner.provision_calls[1] == ("proj-2", STORAGE_CONFIG)

    async def test_tracks_deprovision_calls(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.deprovision("proj-1")
        await provisioner.deprovision("proj-2")
        assert provisioner.deprovision_calls == ["proj-1", "proj-2"]

    async def test_tracks_health_check_calls(self):
        provisioner = MockEnvironmentProvisioner()
        await provisioner.health_check("proj-1")
        await provisioner.health_check("proj-2")
        await provisioner.health_check("proj-1")
        assert provisioner.health_check_calls == ["proj-1", "proj-2", "proj-1"]
