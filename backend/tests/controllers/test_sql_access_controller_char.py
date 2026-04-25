"""Characterization tests — Seam 6: SQL Access controller.

Pins the CURRENT observable behavior of the sql-access endpoints on
HTTPController (L455-497). These tests must remain green after extraction to
`sql_access_controller.py`.

No existing coverage in test_http_controller.py — everything here is new.

KNOWN BUG: seams.md Risks #4 — disable_sql_access returns HTTP 204 with a
non-empty JSON:API body. Per RFC 7230 a 204 response SHOULD have no body. Lift
and shift preserves this; the test below pins the current (buggy) behavior
verbatim so extraction does not accidentally "fix" it without tracking.
"""

from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.sql_access.exceptions import (
    CredentialCooldown,
    EnvironmentNotRunning,
    EnvironmentNotStopped,
    QueryEngineUnreachable,
    SqlAccessAlreadyEnabled,
    SqlAccessNotEnabled,
)

# ---------------------------------------------------------------------------
# enable_sql_access (L455-461)
# ---------------------------------------------------------------------------


class TestEnableSqlAccessCharacterization:
    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_success_returns_201_with_envelope(self, mock_uc):
        mock_uc.enable_sql_access = AsyncMock(
            return_value=Success({"id": "sa-1", "project_id": "p1", "status": "enabled"})
        )
        body, status = await HTTPController.enable_sql_access("p1", user="U")
        assert status == 201
        assert body["data"]["type"] == "sql-access"
        assert body["data"]["id"] == "sa-1"
        assert body["links"]["self"] == "/api/projects/p1/sql-access"

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_forwards_project_id_user_project(self, mock_uc):
        mock_uc.enable_sql_access = AsyncMock(return_value=Success({"id": "sa-1"}))
        proj = {"id": "p1"}
        await HTTPController.enable_sql_access("p1", user="USER_SENTINEL", project=proj)
        mock_uc.enable_sql_access.assert_awaited_once_with("p1", user="USER_SENTINEL", project=proj)

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_already_enabled_returns_409(self, mock_uc):
        mock_uc.enable_sql_access = AsyncMock(return_value=Failure(SqlAccessAlreadyEnabled("p1")))
        _, status = await HTTPController.enable_sql_access("p1", user="U")
        assert status == 409

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_environment_not_running_returns_409(self, mock_uc):
        mock_uc.enable_sql_access = AsyncMock(return_value=Failure(EnvironmentNotRunning("p1")))
        _, status = await HTTPController.enable_sql_access("p1", user="U")
        assert status == 409


# ---------------------------------------------------------------------------
# disable_sql_access (L463-470) — KNOWN BUG: 204 with body
# ---------------------------------------------------------------------------


class TestDisableSqlAccessCharacterization:
    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_success_returns_204_with_non_empty_body(self, mock_uc):
        """KNOWN BUG: seams.md Risks #4 — disable_sql_access returns 204 with a
        JSON:API body (L468 `wrap_jsonapi_single(...), 204`). Per RFC 7230 a
        204 response SHOULD have no body. Locked in by characterization; fix
        scheduled separately."""
        mock_uc.disable_sql_access = AsyncMock(return_value=Success({"id": "sa-1", "status": "disabled"}))
        body, status = await HTTPController.disable_sql_access("p1")
        assert status == 204
        # Buggy but preserved: body is the JSON:API single envelope, not empty
        assert body["data"]["type"] == "sql-access"
        assert body["data"]["id"] == "sa-1"

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_forwards_project_id_and_project(self, mock_uc):
        mock_uc.disable_sql_access = AsyncMock(return_value=Success({"id": "sa-1"}))
        proj = {"id": "p1"}
        await HTTPController.disable_sql_access("p1", project=proj)
        mock_uc.disable_sql_access.assert_awaited_once_with("p1", project=proj)

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_not_enabled_returns_404(self, mock_uc):
        mock_uc.disable_sql_access = AsyncMock(return_value=Failure(SqlAccessNotEnabled("p1")))
        _, status = await HTTPController.disable_sql_access("p1")
        assert status == 404

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_environment_not_stopped_returns_409(self, mock_uc):
        mock_uc.disable_sql_access = AsyncMock(return_value=Failure(EnvironmentNotStopped("p1")))
        _, status = await HTTPController.disable_sql_access("p1")
        assert status == 409


# ---------------------------------------------------------------------------
# get_sql_access (L472-479)
# ---------------------------------------------------------------------------


class TestGetSqlAccessCharacterization:
    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_success_returns_200_with_envelope(self, mock_uc):
        mock_uc.get_sql_access = AsyncMock(return_value=Success({"id": "sa-1", "project_id": "p1"}))
        body, status = await HTTPController.get_sql_access("p1")
        assert status == 200
        assert body["data"]["type"] == "sql-access"
        assert body["data"]["id"] == "sa-1"
        assert body["links"]["self"] == "/api/projects/p1/sql-access"

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_not_enabled_returns_404(self, mock_uc):
        mock_uc.get_sql_access = AsyncMock(return_value=Failure(SqlAccessNotEnabled("p1")))
        _, status = await HTTPController.get_sql_access("p1")
        assert status == 404


# ---------------------------------------------------------------------------
# sync_sql_access (L481-488)
# ---------------------------------------------------------------------------


class TestSyncSqlAccessCharacterization:
    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.sync_sql_access = AsyncMock(return_value=Success({"id": "sa-1", "synced_at": "2024-01-01"}))
        body, status = await HTTPController.sync_sql_access("p1")
        assert status == 200
        assert body["data"]["type"] == "sql-access"
        assert body["links"]["self"] == "/api/projects/p1/sql-access"

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_query_engine_unreachable_returns_502(self, mock_uc):
        mock_uc.sync_sql_access = AsyncMock(return_value=Failure(QueryEngineUnreachable("qe1")))
        _, status = await HTTPController.sync_sql_access("p1")
        assert status == 502


# ---------------------------------------------------------------------------
# regenerate_sql_credentials (L490-497) — CredentialCooldown retry_after
# ---------------------------------------------------------------------------


class TestRegenerateSqlCredentialsCharacterization:
    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.regenerate_sql_credentials = AsyncMock(
            return_value=Success({"id": "sa-1", "credentials": {"username": "u", "password": "p"}})
        )
        body, status = await HTTPController.regenerate_sql_credentials("p1")
        assert status == 200
        assert body["data"]["type"] == "sql-access"
        assert body["links"]["self"] == "/api/projects/p1/sql-access"

    @patch("app.controllers.http_controller.sql_access_use_cases")
    async def test_cooldown_returns_429_with_retry_after(self, mock_uc):
        """The only code path in the controller that exercises the
        `retry_after` branch of `_error_response` (L51-52). Pin end-to-end."""
        mock_uc.regenerate_sql_credentials = AsyncMock(return_value=Failure(CredentialCooldown(seconds_remaining=120)))
        body, status = await HTTPController.regenerate_sql_credentials("p1")
        assert status == 429
        assert body["errors"][0]["title"] == "Credential Regeneration Too Soon"
        assert body["errors"][0]["retry_after"] == 120
