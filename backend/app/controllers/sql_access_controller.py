"""External SQL Access HTTP controller (External SQL Access Provisioning context).

Thin HTTP adapter for the ProjectSQLAccess aggregate. Project-scoped, downstream
of the Query Engine Fleet (QueryEngineController). The routers depend on this
class directly; there is deliberately no roll-up through a god ``HTTPController``.

Each endpoint declares its use case as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.sql_access``, typed against a ``Protocol`` that captures the call
interface the controller relies on. Production passes nothing (the defaults
bind); tests inject a function matching the Protocol, so a fake use case needs no
module-level monkeypatching to intercept the call.

NOTE: ``disable_sql_access`` returns a JSON:API body with status 204 — a latent
bug (204 No Content should have an empty body). It is preserved intentionally;
fix separately.
"""

from typing import TYPE_CHECKING, Any, Protocol

from returns.result import Failure, Result, Success

from app.use_cases import sql_access as sql_access_use_cases

from ._result_mapper import error_response
from .response_wrapper import wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


class EnableSqlAccessProtocol(Protocol):
    """Call interface for the enable-sql-access use case."""

    async def __call__(self, project_id: str, user: "AuthUser", project: dict | None = None) -> Result[dict, Any]: ...


class DisableSqlAccessProtocol(Protocol):
    """Call interface for the disable-sql-access use case."""

    async def __call__(self, project_id: str, project: dict | None = None) -> Result[dict, Any]: ...


class GetSqlAccessProtocol(Protocol):
    """Call interface for the get-sql-access use case."""

    async def __call__(self, project_id: str, project: dict | None = None) -> Result[dict, Any]: ...


class SyncSqlAccessProtocol(Protocol):
    """Call interface for the sync-sql-access use case."""

    async def __call__(self, project_id: str, project: dict | None = None) -> Result[dict, Any]: ...


class RegenerateSqlCredentialsProtocol(Protocol):
    """Call interface for the regenerate-sql-credentials use case."""

    async def __call__(self, project_id: str, project: dict | None = None) -> Result[dict, Any]: ...


class SQLAccessController:
    """Controller for ProjectSQLAccess aggregate HTTP endpoints."""

    @staticmethod
    async def enable_sql_access(
        project_id: str,
        user: "AuthUser",
        project: dict | None = None,
        *,
        enable_sql_access_func: EnableSqlAccessProtocol = sql_access_use_cases.enable_sql_access,
    ) -> tuple[dict, int]:
        result = await enable_sql_access_func(project_id, user=user, project=project)
        match result:
            case Success(data):
                return (
                    wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"),
                    201,
                )
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def disable_sql_access(
        project_id: str,
        project: dict | None = None,
        *,
        disable_sql_access_func: DisableSqlAccessProtocol = sql_access_use_cases.disable_sql_access,
    ) -> tuple[dict, int]:
        result = await disable_sql_access_func(project_id, project=project)
        match result:
            case Success(data):
                # NOTE: 204 with JSON body is a latent bug — preserved intentionally.
                return (
                    wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"),
                    204,
                )
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_sql_access(
        project_id: str,
        project: dict | None = None,
        *,
        get_sql_access_func: GetSqlAccessProtocol = sql_access_use_cases.get_sql_access,
    ) -> tuple[dict, int]:
        result = await get_sql_access_func(project_id, project=project)
        match result:
            case Success(data):
                return (
                    wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"),
                    200,
                )
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def sync_sql_access(
        project_id: str,
        project: dict | None = None,
        *,
        sync_sql_access_func: SyncSqlAccessProtocol = sql_access_use_cases.sync_sql_access,
    ) -> tuple[dict, int]:
        result = await sync_sql_access_func(project_id, project=project)
        match result:
            case Success(data):
                return (
                    wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"),
                    200,
                )
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def regenerate_sql_credentials(
        project_id: str,
        project: dict | None = None,
        *,
        regenerate_sql_credentials_func: RegenerateSqlCredentialsProtocol = (
            sql_access_use_cases.regenerate_sql_credentials
        ),
    ) -> tuple[dict, int]:
        result = await regenerate_sql_credentials_func(project_id, project=project)
        match result:
            case Success(data):
                return (
                    wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"),
                    200,
                )
            case Failure(error):
                return error_response(error)
