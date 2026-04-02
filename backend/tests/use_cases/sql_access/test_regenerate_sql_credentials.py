"""Tests for regenerate_sql_credentials use case."""

from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.sql_access import regenerate_sql_credentials
from app.use_cases.sql_access.exceptions import CredentialCooldown, SqlAccessNotEnabled
from tests.uuidv7_fixtures import PROJECT_1


class TestRegenerateSqlCredentials:
    @patch("app.use_cases.sql_access.regenerate_sql_credentials.get_settings")
    @patch("app.use_cases.sql_access.regenerate_sql_credentials.regenerate_proxy_credentials", new_callable=AsyncMock)
    async def test_regenerate_when_enabled_returns_new_password(
        self, mock_regenerate, mock_get_settings, seeded_db_with_access
    ):
        from app.config import Settings

        mock_get_settings.return_value = Settings(credential_regen_cooldown_seconds=0)
        set_session(seeded_db_with_access)

        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Success)
        data = result.unwrap()
        assert data["password"] is not None
        assert len(data["password"]) == 32
        assert data["host"] == "query-engine"
        assert data["port"] == 5432
        assert "connection_string" in data
        mock_regenerate.assert_called_once()

    async def test_regenerate_when_project_nonexistent_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await regenerate_sql_credentials(project_id="nonexistent")

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), ProjectNotFound)

    async def test_regenerate_when_not_enabled_returns_failure(self, seeded_db):
        set_session(seeded_db)

        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), SqlAccessNotEnabled)

    async def test_regenerate_when_within_cooldown_returns_rate_limit_failure(self, seeded_db_with_access):
        set_session(seeded_db_with_access)

        # Default cooldown is 60 seconds, and the record was just created
        result = await regenerate_sql_credentials(project_id=PROJECT_1)

        assert isinstance(result, Failure)
        assert isinstance(result.failure(), CredentialCooldown)
