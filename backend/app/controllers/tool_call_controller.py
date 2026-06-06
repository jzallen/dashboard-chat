"""Tool-call (assistant audit) HTTP controller — rich-catalog §2.11.

Thin HTTP adapter for the read that backs the UI's ``getAudit``. Delegates to
``app/use_cases/tool_call`` and emits a JSON:API list whose item attributes carry
``node_id``/``node_kind`` + ``tool``/``say``/``tag`` (from the record's JSON
payload) + ``transform_id``/``enabled`` (from the reversed-FK join). Mirrors the
project-scoped list controllers (e.g. :class:`ViewController`).

The ``tool_call_use_cases`` alias is read off ``http_controller`` at call time so
test patches on ``app.controllers.http_controller.tool_call_use_cases`` continue
to intercept.
"""

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list


def _uc():
    from app.controllers import http_controller

    return http_controller.tool_call_use_cases


class ToolCallController:
    """Controller for the tool-call audit read endpoint."""

    @staticmethod
    async def list_tool_calls(project_id: str, org_id: str) -> tuple[dict, int]:
        result = await _uc().list_tool_calls_for_project(project_id, org_id=org_id)
        match result:
            case Success(data):
                items = serialize(data)
                url = f"/api/projects/{project_id}/tool-calls"
                return wrap_jsonapi_list("tool-calls", items, url, len(items), None, False), 200
            case Failure(error):
                return error_response(error)
