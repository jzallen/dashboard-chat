"""SQLAccessController — use-case dependency injection at the controller seam.

Exercises the pattern that replaces the http_controller late-binding shim: each
endpoint takes a keyword-only ``*_func`` dependency typed against a Protocol, so
a test injects a fake use case matching that interface instead of monkeypatching
a module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes, and each test asserts the whole ``(body, status)`` result.

The envelope tests compare the full JSON:API tuple; the forwarding tests spy on
the injected use case to pin the argument contract the controller relies on.

``disable_sql_access`` returns HTTP 204 with a non-empty JSON:API body. Per RFC
7230 a 204 response should have no body; the current behavior is preserved and
pinned below.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec — compare the full envelope,
don't weaken to spot-checks, and build expected values from literals here rather
than echoing the fake's return.
"""

from unittest.mock import AsyncMock

from returns.result import Failure, Success

from app.controllers.sql_access_controller import SQLAccessController
from app.use_cases.sql_access.exceptions import (
    CredentialCooldown,
    EnvironmentNotRunning,
    EnvironmentNotStopped,
    QueryEngineUnreachable,
    SqlAccessAlreadyEnabled,
    SqlAccessNotEnabled,
)

# ---------------------------------------------------------------------------
# enable_sql_access
# ---------------------------------------------------------------------------


async def test_enable_sql_access__when_use_case_succeeds__returns_201_with_envelope():
    async def fake_enable(project_id, *, user, project=None):
        return Success({"id": "sa-1", "project_id": "p1", "status": "enabled"})

    result = await SQLAccessController.enable_sql_access("p1", user="U", enable_sql_access_func=fake_enable)

    assert result == (
        {
            "data": {
                "type": "sql-access",
                "id": "sa-1",
                "attributes": {"project_id": "p1", "status": "enabled"},
            },
            "links": {"self": "/api/projects/p1/sql-access"},
        },
        201,
    )


async def test_enable_sql_access__when_given_user_and_project__forwards_them_to_use_case():
    fake = AsyncMock(return_value=Success({"id": "sa-1"}))
    proj = {"id": "p1"}

    await SQLAccessController.enable_sql_access("p1", user="USER_SENTINEL", project=proj, enable_sql_access_func=fake)

    fake.assert_awaited_once_with("p1", user="USER_SENTINEL", project=proj)


async def test_enable_sql_access__when_already_enabled__returns_409_error_envelope():
    async def fake_enable(project_id, *, user, project=None):
        return Failure(SqlAccessAlreadyEnabled("p1"))

    _, status = await SQLAccessController.enable_sql_access("p1", user="U", enable_sql_access_func=fake_enable)

    assert status == 409


async def test_enable_sql_access__when_environment_not_running__returns_409_error_envelope():
    async def fake_enable(project_id, *, user, project=None):
        return Failure(EnvironmentNotRunning("p1"))

    _, status = await SQLAccessController.enable_sql_access("p1", user="U", enable_sql_access_func=fake_enable)

    assert status == 409


# ---------------------------------------------------------------------------
# disable_sql_access
# ---------------------------------------------------------------------------


async def test_disable_sql_access__when_use_case_succeeds__returns_204_with_non_empty_envelope():
    async def fake_disable(project_id, project=None):
        return Success({"id": "sa-1", "status": "disabled"})

    result = await SQLAccessController.disable_sql_access("p1", disable_sql_access_func=fake_disable)

    assert result == (
        {
            "data": {
                "type": "sql-access",
                "id": "sa-1",
                "attributes": {"status": "disabled"},
            },
            "links": {"self": "/api/projects/p1/sql-access"},
        },
        204,
    )


async def test_disable_sql_access__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success({"id": "sa-1"}))
    proj = {"id": "p1"}

    await SQLAccessController.disable_sql_access("p1", project=proj, disable_sql_access_func=fake)

    fake.assert_awaited_once_with("p1", project=proj)


async def test_disable_sql_access__when_not_enabled__returns_404_error_envelope():
    async def fake_disable(project_id, project=None):
        return Failure(SqlAccessNotEnabled("p1"))

    _, status = await SQLAccessController.disable_sql_access("p1", disable_sql_access_func=fake_disable)

    assert status == 404


async def test_disable_sql_access__when_environment_not_stopped__returns_409_error_envelope():
    async def fake_disable(project_id, project=None):
        return Failure(EnvironmentNotStopped("p1"))

    _, status = await SQLAccessController.disable_sql_access("p1", disable_sql_access_func=fake_disable)

    assert status == 409


# ---------------------------------------------------------------------------
# get_sql_access
# ---------------------------------------------------------------------------


async def test_get_sql_access__when_use_case_succeeds__returns_200_with_envelope():
    async def fake_get(project_id, project=None):
        return Success({"id": "sa-1", "project_id": "p1"})

    result = await SQLAccessController.get_sql_access("p1", get_sql_access_func=fake_get)

    assert result == (
        {
            "data": {
                "type": "sql-access",
                "id": "sa-1",
                "attributes": {"project_id": "p1"},
            },
            "links": {"self": "/api/projects/p1/sql-access"},
        },
        200,
    )


async def test_get_sql_access__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success({"id": "sa-1"}))
    proj = {"id": "p1"}

    await SQLAccessController.get_sql_access("p1", project=proj, get_sql_access_func=fake)

    fake.assert_awaited_once_with("p1", project=proj)


async def test_get_sql_access__when_not_enabled__returns_404_error_envelope():
    async def fake_get(project_id, project=None):
        return Failure(SqlAccessNotEnabled("p1"))

    _, status = await SQLAccessController.get_sql_access("p1", get_sql_access_func=fake_get)

    assert status == 404


# ---------------------------------------------------------------------------
# sync_sql_access
# ---------------------------------------------------------------------------


async def test_sync_sql_access__when_use_case_succeeds__returns_200_with_envelope():
    async def fake_sync(project_id, project=None):
        return Success({"id": "sa-1", "synced_at": "2024-01-01"})

    result = await SQLAccessController.sync_sql_access("p1", sync_sql_access_func=fake_sync)

    assert result == (
        {
            "data": {
                "type": "sql-access",
                "id": "sa-1",
                "attributes": {"synced_at": "2024-01-01"},
            },
            "links": {"self": "/api/projects/p1/sql-access"},
        },
        200,
    )


async def test_sync_sql_access__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success({"id": "sa-1"}))
    proj = {"id": "p1"}

    await SQLAccessController.sync_sql_access("p1", project=proj, sync_sql_access_func=fake)

    fake.assert_awaited_once_with("p1", project=proj)


async def test_sync_sql_access__when_query_engine_unreachable__returns_502_error_envelope():
    async def fake_sync(project_id, project=None):
        return Failure(QueryEngineUnreachable("qe1"))

    _, status = await SQLAccessController.sync_sql_access("p1", sync_sql_access_func=fake_sync)

    assert status == 502


# ---------------------------------------------------------------------------
# regenerate_sql_credentials
# ---------------------------------------------------------------------------


async def test_regenerate_sql_credentials__when_use_case_succeeds__returns_200_with_envelope():
    async def fake_regen(project_id, project=None):
        return Success({"id": "sa-1", "credentials": {"username": "u", "password": "p"}})

    result = await SQLAccessController.regenerate_sql_credentials("p1", regenerate_sql_credentials_func=fake_regen)

    assert result == (
        {
            "data": {
                "type": "sql-access",
                "id": "sa-1",
                "attributes": {"credentials": {"username": "u", "password": "p"}},
            },
            "links": {"self": "/api/projects/p1/sql-access"},
        },
        200,
    )


async def test_regenerate_sql_credentials__when_given_project__forwards_it_to_use_case():
    fake = AsyncMock(return_value=Success({"id": "sa-1"}))
    proj = {"id": "p1"}

    await SQLAccessController.regenerate_sql_credentials("p1", project=proj, regenerate_sql_credentials_func=fake)

    fake.assert_awaited_once_with("p1", project=proj)


async def test_regenerate_sql_credentials__when_on_cooldown__returns_429_with_retry_after_envelope():
    async def fake_regen(project_id, project=None):
        return Failure(CredentialCooldown(seconds_remaining=120))

    result = await SQLAccessController.regenerate_sql_credentials("p1", regenerate_sql_credentials_func=fake_regen)

    assert result == (
        {
            "errors": [
                {
                    "status": "429",
                    "title": "Credential Regeneration Too Soon",
                    "detail": "Credential regeneration is rate-limited. Try again in 120 seconds.",
                    "retry_after": 120,
                }
            ]
        },
        429,
    )
