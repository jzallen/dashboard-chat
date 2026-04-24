"""View HTTP controller — Seam 5a of dc-e65d.

Thin HTTP adapter for the Analytics Authoring bounded context (View half).
A View is a user-authored saved query/transform spec over datasets.
Delegates to `app/use_cases/view`.

The `view_use_cases` alias is read off `http_controller` at call time so
that test patches on `app.controllers.http_controller.view_use_cases`
continue to intercept.

NOTE: `get_view` inlines `ViewSQLGenerator().generate_display(data)` — this
is a controller-layer leak that should be pushed down into the use case
(see seams.md Risks #3). Preserved intentionally under the characterize-
before-refactor discipline of this bead. Fix separately.
"""

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


def _uc():
    from app.controllers import http_controller

    return http_controller.view_use_cases


class ViewController:
    """Controller for View aggregate HTTP endpoints."""

    @staticmethod
    async def list_views(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().list_views(project_id, project=project)
        match result:
            case Success(data):
                items = serialize(data)
                views_url = f"/api/projects/{project_id}/views"
                return wrap_jsonapi_list("views", items, views_url, len(items), None, False), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_view(project_id: str, project: dict | None = None, **kwargs) -> tuple[dict, int]:
        result = await _uc().create_view(project_id=project_id, project=project, **kwargs)
        match result:
            case Success(data):
                serialized = serialize(data)
                link = f"/api/projects/{project_id}/views/{serialized['id']}"
                return wrap_jsonapi_single("views", serialized, link), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_view(view_id: str, project: dict | None = None) -> tuple[dict, int]:
        # NOTE: controller-layer leak — ViewSQLGenerator belongs in the use case.
        # Pinned by characterization (seams.md Risks #3).
        from app.use_cases.view.sql_generator import ViewSQLGenerator

        result = await _uc().get_view(view_id, project=project)
        match result:
            case Success(data):
                serialized = serialize(data)
                serialized["display_sql"] = ViewSQLGenerator().generate_display(data)
                return wrap_jsonapi_single("views", serialized, f"/api/views/{view_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_view(view_id: str, project: dict | None = None, **kwargs) -> tuple[dict, int]:
        result = await _uc().update_view(view_id, kwargs, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("views", serialize(data), f"/api/views/{view_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def delete_view(view_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().delete_view(view_id, project=project)
        match result:
            case Success(data):
                return {"meta": {"deleted": data}}, 200
            case Failure(error):
                return error_response(error)
