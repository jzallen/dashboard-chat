"""View HTTP controller (Analytics Authoring bounded context, View half).

Thin HTTP adapter for the View aggregate — a View is a user-authored saved
query/transform spec over datasets. The routers depend on this class directly;
there is deliberately no roll-up through a god ``HTTPController``.

Each endpoint declares its use case as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.view``, typed against a ``Protocol`` that captures the call
interface the controller relies on. Production passes nothing (the defaults
bind); tests inject a function matching the Protocol, so a fake use case needs no
module-level monkeypatching to intercept the call.

NOTE: ``get_view`` inlines ``ViewSQLGenerator().generate_display(data)`` — a
controller-layer leak of view-rendering logic that belongs in the use case. It
is preserved intentionally; fix separately.
"""

from typing import Any, Protocol

from returns.result import Failure, Result, Success

from app.use_cases import view as view_use_cases

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


class ListViewsProtocol(Protocol):
    """Call interface for the list-views use case."""

    async def __call__(self, project_id: str, project: dict | None = None) -> Result: ...


class CreateViewProtocol(Protocol):
    """Call interface for the create-view use case."""

    async def __call__(self, *, project_id: str, project: dict | None = None, **kwargs: Any) -> Result: ...


class GetViewProtocol(Protocol):
    """Call interface for the get-view use case."""

    async def __call__(self, view_id: str, project: dict | None = None) -> Result: ...


class UpdateViewProtocol(Protocol):
    """Call interface for the update-view use case."""

    async def __call__(self, view_id: str, update_data: dict[str, Any], project: dict | None = None) -> Result: ...


class DeleteViewProtocol(Protocol):
    """Call interface for the delete-view use case."""

    async def __call__(self, view_id: str, project: dict | None = None) -> Result: ...


class ViewController:
    """Controller for View aggregate HTTP endpoints."""

    @staticmethod
    async def list_views(
        project_id: str,
        project: dict | None = None,
        *,
        list_views_func: ListViewsProtocol = view_use_cases.list_views,
    ) -> tuple[dict, int]:
        result = await list_views_func(project_id, project=project)
        match result:
            case Success(views):
                items = serialize(views)
                views_url = f"/api/projects/{project_id}/views"
                return wrap_jsonapi_list("views", items, views_url, len(items), None, False), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_view(
        project_id: str,
        project: dict | None = None,
        *,
        create_view_func: CreateViewProtocol = view_use_cases.create_view,
        **kwargs,
    ) -> tuple[dict, int]:
        result = await create_view_func(project_id=project_id, project=project, **kwargs)
        match result:
            case Success(created_view):
                serialized = serialize(created_view)
                link = f"/api/projects/{project_id}/views/{serialized['id']}"
                return wrap_jsonapi_single("views", serialized, link), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_view(
        view_id: str,
        project: dict | None = None,
        *,
        get_view_func: GetViewProtocol = view_use_cases.get_view,
    ) -> tuple[dict, int]:
        # NOTE: controller-layer leak — ViewSQLGenerator belongs in the use case.
        from app.use_cases.view.sql_generator import ViewSQLGenerator

        result = await get_view_func(view_id, project=project)
        match result:
            case Success(view):
                serialized = serialize(view)
                serialized["display_sql"] = ViewSQLGenerator().generate_display(view)
                return wrap_jsonapi_single("views", serialized, f"/api/views/{view_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_view(
        view_id: str,
        project: dict | None = None,
        *,
        update_view_func: UpdateViewProtocol = view_use_cases.update_view,
        **kwargs,
    ) -> tuple[dict, int]:
        result = await update_view_func(view_id, kwargs, project=project)
        match result:
            case Success(updated_view):
                return wrap_jsonapi_single("views", serialize(updated_view), f"/api/views/{view_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def delete_view(
        view_id: str,
        project: dict | None = None,
        *,
        delete_view_func: DeleteViewProtocol = view_use_cases.delete_view,
    ) -> tuple[dict, int]:
        result = await delete_view_func(view_id, project=project)
        match result:
            case Success(deleted):
                return {"meta": {"deleted": deleted}}, 200
            case Failure(error):
                return error_response(error)
