"""Project HTTP controller (Project & Workspace bounded context).

Thin HTTP adapter for the Project aggregate — the multi-tenancy anchor. The
router depends on this class directly; there is deliberately no roll-up through
a god ``HTTPController``.

Each endpoint declares its use case as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.project``, typed against a ``Protocol`` that captures the call
interface the controller relies on. Production passes nothing (the defaults
bind); tests inject a function matching the Protocol instead of monkeypatching a
module-level alias. This is the seam that replaces the ``_uc()`` late-binding
shim inherited from the http_controller DDD refactor.
"""

from typing import TYPE_CHECKING, Any, Protocol, TypedDict

from returns.result import Failure, Result, Success

from app.use_cases import project as project_use_cases

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single

if TYPE_CHECKING:
    from app.auth.types import AuthUser


class ProjectListPage(TypedDict):
    """One cursor-paginated page of projects, as returned by the list use case.

    Unlike the other endpoints — which hand back a single serializable model —
    listing wraps its rows in a pagination envelope that the controller unpacks
    into the JSON:API list response.
    """

    items: list[dict]
    next_cursor: str | None
    has_more: bool
    page_size: int


class ListProjectsProtocol(Protocol):
    """Call interface for the list-projects use case."""

    async def __call__(
        self,
        *,
        user: "AuthUser | None" = None,
        cursor: str | None = None,
        page_size: int = 50,
    ) -> Result[ProjectListPage, Any]: ...


class GetProjectProtocol(Protocol):
    """Call interface for the get-project use case."""

    async def __call__(self, project_id: str, *, user: "AuthUser | None" = None) -> Result: ...


class CreateProjectProtocol(Protocol):
    """Call interface for the create-project use case."""

    async def __call__(
        self,
        *,
        name: str,
        description: str | None = None,
        user: "AuthUser | None" = None,
    ) -> Result: ...


class UpdateProjectProtocol(Protocol):
    """Call interface for the update-project use case."""

    async def __call__(
        self,
        project_id: str,
        update_data: dict[str, Any],
        *,
        user: "AuthUser | None" = None,
        project: dict | None = None,
    ) -> Result: ...


class DeleteProjectProtocol(Protocol):
    """Call interface for the delete-project use case."""

    async def __call__(
        self,
        project_id: str,
        *,
        user: "AuthUser | None" = None,
        project: dict | None = None,
    ) -> Result: ...


class ProjectController:
    """Controller for Project aggregate HTTP endpoints."""

    @staticmethod
    async def list_projects(
        cursor: str | None = None,
        page_size: int = 50,
        user: "AuthUser | None" = None,
        *,
        list_projects_func: ListProjectsProtocol = project_use_cases.list_projects,
    ) -> tuple[dict, int]:
        result = await list_projects_func(user=user, cursor=cursor, page_size=page_size)
        match result:
            case Success(projects_page):
                resp = wrap_jsonapi_list(
                    "projects",
                    projects_page["items"],
                    "/api/projects",
                    projects_page["page_size"],
                    projects_page["next_cursor"],
                    projects_page["has_more"],
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_project(
        project_id: str,
        user: "AuthUser | None" = None,
        *,
        get_project_func: GetProjectProtocol = project_use_cases.get_project,
    ) -> tuple[dict, int]:
        result = await get_project_func(project_id, user=user)
        match result:
            case Success(project):
                return wrap_jsonapi_single("projects", serialize(project), f"/api/projects/{project_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_project(
        name: str,
        description: str | None = None,
        user: "AuthUser | None" = None,
        *,
        create_project_func: CreateProjectProtocol = project_use_cases.create_project,
    ) -> tuple[dict, int]:
        result = await create_project_func(name=name, description=description, user=user)
        match result:
            case Success(created_project):
                serialized = serialize(created_project)
                return wrap_jsonapi_single("projects", serialized, f"/api/projects/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_project(
        project_id: str,
        user: "AuthUser | None" = None,
        project: dict | None = None,
        *,
        update_project_func: UpdateProjectProtocol = project_use_cases.update_project,
        **kwargs,
    ) -> tuple[dict, int]:
        result = await update_project_func(project_id, kwargs, user=user, project=project)
        match result:
            case Success(updated_project):
                return wrap_jsonapi_single("projects", serialize(updated_project), f"/api/projects/{project_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def delete_project(
        project_id: str,
        user: "AuthUser | None" = None,
        project: dict | None = None,
        *,
        delete_project_func: DeleteProjectProtocol = project_use_cases.delete_project,
    ) -> tuple[dict, int]:
        result = await delete_project_func(project_id, user=user, project=project)
        match result:
            case Success(deleted):
                return {"meta": {"deleted": deleted}}, 200
            case Failure(error):
                return error_response(error)
