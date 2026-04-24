"""Query Engine Fleet HTTP controller — Seam 7 of dc-e65d.

Thin HTTP adapter for the Query Engine Fleet Admin bounded context.
Org-scoped (not project-scoped) — operates on the shared query-engine nodes
that SQL Access provisions into. Delegates to `app/use_cases/query_engine`.

The `query_engine_use_cases` alias is read off `http_controller` at call time
so that test patches on `app.controllers.http_controller.query_engine_use_cases`
continue to intercept.
"""

from typing import TYPE_CHECKING

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


def _uc():
    from app.controllers import http_controller

    return http_controller.query_engine_use_cases


class QueryEngineController:
    """Controller for QueryEngineNode (fleet) HTTP endpoints."""

    @staticmethod
    async def list_query_engines(user: "AuthUser") -> tuple[dict, int]:
        result = await _uc().list_query_engines(user.org_id)
        match result:
            case Success(data):
                items = serialize(data)
                return wrap_jsonapi_list("query-engines", items, "/api/query-engines", len(items), None, False), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_query_engine(node_id: str, user: "AuthUser") -> tuple[dict, int]:
        result = await _uc().get_query_engine(node_id, user.org_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("query-engines", data, f"/api/query-engines/{node_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def test_query_engine(node_id: str, user: "AuthUser") -> tuple[dict, int]:
        result = await _uc().test_query_engine_connection(node_id, user.org_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("query-engines", data, f"/api/query-engines/{node_id}/test"), 200
            case Failure(error):
                return error_response(error)
