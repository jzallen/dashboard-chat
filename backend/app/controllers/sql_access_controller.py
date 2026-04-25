"""External SQL Access HTTP controller — Seam 6 of dc-e65d.

Thin HTTP adapter for the External SQL Access Provisioning bounded context.
Project-scoped. Downstream of the Query Engine Fleet (QueryEngineController).

The `sql_access_use_cases` alias is read off `http_controller` at call time
so that test patches on `app.controllers.http_controller.sql_access_use_cases`
continue to intercept.

NOTE: `disable_sql_access` returns a JSON:API body with status 204 — this is a
latent bug (204 No Content should have an empty body, see seams.md Risks #4).
It is preserved intentionally under the characterization-before-refactor
discipline of this bead. Fix separately.
"""

from typing import TYPE_CHECKING

from returns.result import Failure, Success

from ._result_mapper import error_response
from .response_wrapper import wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


def _uc():
    from app.controllers import http_controller

    return http_controller.sql_access_use_cases


class SQLAccessController:
    """Controller for ProjectSQLAccess aggregate HTTP endpoints."""

    @staticmethod
    async def enable_sql_access(project_id: str, user: "AuthUser", project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().enable_sql_access(project_id, user=user, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def disable_sql_access(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().disable_sql_access(project_id, project=project)
        match result:
            case Success(data):
                # NOTE: 204 with JSON body is a latent bug — pinned by characterization.
                return wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"), 204
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_sql_access(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().get_sql_access(project_id, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def sync_sql_access(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().sync_sql_access(project_id, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def regenerate_sql_credentials(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().regenerate_sql_credentials(project_id, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sql-access", data, f"/api/projects/{project_id}/sql-access"), 200
            case Failure(error):
                return error_response(error)
