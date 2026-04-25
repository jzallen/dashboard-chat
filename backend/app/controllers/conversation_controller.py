"""Conversation (Session + Memory) HTTP controller — Seam 3 of dc-e65d.

Thin HTTP adapter for the Conversation bounded context — chat sessions
(Stream threads) and persistent project memory (Stream channels). The class
is named `ConversationController` to resolve the overloaded "session" term
(DB session vs. auth session vs. chat session) — see seams.md Ubiquitous
Language notes.

Use cases accessed here are SUBMODULES (not package aliases). The submodule
names are read off `http_controller` at call time:
  - get_project_memory_uc (app.use_cases.memory.get_project_memory)
  - create_session_uc (app.use_cases.session.create_session)
  - list_sessions_uc (app.use_cases.session.list_sessions)
  - update_session_uc (app.use_cases.session.update_session)

This keeps test patches like `@patch("app.controllers.http_controller.create_session_uc")`
working after extraction.
"""

from typing import TYPE_CHECKING, Any

from returns.result import Failure, Success

from ._result_mapper import error_response
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


def _memory_uc():
    from app.controllers import http_controller

    return http_controller.get_project_memory_uc


def _create_session_uc():
    from app.controllers import http_controller

    return http_controller.create_session_uc


def _list_sessions_uc():
    from app.controllers import http_controller

    return http_controller.list_sessions_uc


def _update_session_uc():
    from app.controllers import http_controller

    return http_controller.update_session_uc


class ConversationController:
    """Controller for Session (chat conversation) + ProjectMemory HTTP endpoints."""

    @staticmethod
    async def get_project_memory(project_id: str, user: "AuthUser") -> tuple[dict, int]:
        result = await _memory_uc().get_project_memory(project_id, user=user)
        match result:
            case Success(data):
                return wrap_jsonapi_single("memories", data, f"/api/projects/{project_id}/memory"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_session(project_id: str, user: "AuthUser") -> tuple[dict, int]:
        result = await _create_session_uc().create_session(project_id, user=user)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sessions", data, f"/api/projects/{project_id}/sessions/{data['id']}"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_sessions(
        project_id: str,
        user: "AuthUser",
        cursor: str | None = None,
        page_size: int = 30,
    ) -> tuple[dict, int]:
        result = await _list_sessions_uc().list_sessions(project_id, user=user, cursor=cursor, page_size=page_size)
        match result:
            case Success(data):
                resp = wrap_jsonapi_list(
                    "sessions",
                    data["items"],
                    f"/api/projects/{project_id}/sessions",
                    data["page_size"],
                    data["next_cursor"],
                    data["has_more"],
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_session(project_id: str, session_id: str, user: "AuthUser", **kwargs: Any) -> tuple[dict, int]:
        result = await _update_session_uc().update_session(session_id, update_data=kwargs, user=user)
        match result:
            case Success(data):
                return wrap_jsonapi_single("sessions", data, f"/api/projects/{project_id}/sessions/{session_id}"), 200
            case Failure(error):
                return error_response(error)
