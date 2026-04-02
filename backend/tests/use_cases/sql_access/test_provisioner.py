"""Tests for provisioner abstraction types."""

from app.use_cases.sql_access._infra import (
    ProjectEnvironment,
    ProvisioningError,
    StorageConfig,
)


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
            raise AssertionError("Should have raised FrozenInstanceError")
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
            raise AssertionError("Should have raised FrozenInstanceError")
        except AttributeError:
            pass


class TestProvisioningError:
    def test_is_exception_subclass(self):
        assert issubclass(ProvisioningError, Exception)
        error = ProvisioningError("container failed to start")
        assert str(error) == "container failed to start"
        assert isinstance(error, Exception)
