"""Project HTTP controller — Seam 2 of dc-e65d.

Thin HTTP adapter for the Project & Workspace bounded context (the
multi-tenancy anchor). Delegates to `app/use_cases/project`.

The `project_use_cases` alias is read off `http_controller` at call time
so that test patches on `app.controllers.http_controller.project_use_cases`
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

    return http_controller.project_use_cases


class ProjectController:
    """Controller for Project aggregate HTTP endpoints."""

    @staticmethod
    async def list_projects(
        cursor: str | None = None,
        page_size: int = 50,
        base_url: str = "/api/projects",
        user: "AuthUser | None" = None,
    ) -> tuple[dict, int]:
        result = await _uc().list_projects(user=user, cursor=cursor, page_size=page_size)
        match result:
            case Success(data):
                items = data["items"]
                resp = wrap_jsonapi_list(
                    "projects", items, base_url, data["page_size"], data["next_cursor"], data["has_more"]
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_project(project_id: str, user: "AuthUser | None" = None) -> tuple[dict, int]:
        result = await _uc().get_project(project_id, user=user)
        match result:
            case Success(data):
                return wrap_jsonapi_single("projects", serialize(data), f"/api/projects/{project_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_project(
        name: str, description: str | None = None, user: "AuthUser | None" = None
    ) -> tuple[dict, int]:
        result = await _uc().create_project(name=name, description=description, user=user)
        match result:
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("projects", serialized, f"/api/projects/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_project(
        project_id: str,
        user: "AuthUser | None" = None,
        project: dict | None = None,
        **kwargs,
    ) -> tuple[dict, int]:
        result = await _uc().update_project(project_id, kwargs, user=user, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("projects", serialize(data), f"/api/projects/{project_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def delete_project(
        project_id: str, user: "AuthUser | None" = None, project: dict | None = None
    ) -> tuple[dict, int]:
        result = await _uc().delete_project(project_id, user=user, project=project)
        match result:
            case Success(data):
                return {"meta": {"deleted": data}}, 200
            case Failure(error):
                return error_response(error)
