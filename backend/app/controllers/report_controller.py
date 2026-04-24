"""Report HTTP controller — Seam 5b of dc-e65d.

Thin HTTP adapter for the Analytics Authoring bounded context (Report half).
A Report is a saved visualization/summary referencing zero or more views
or datasets. Delegates to `app/use_cases/report`.

The `report_use_cases` alias is read off `http_controller` at call time so
that test patches on `app.controllers.http_controller.report_use_cases`
continue to intercept.
"""

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


def _uc():
    from app.controllers import http_controller

    return http_controller.report_use_cases


class ReportController:
    """Controller for Report aggregate HTTP endpoints."""

    @staticmethod
    async def list_reports(project_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().list_reports(project_id, project=project)
        match result:
            case Success(data):
                items = serialize(data)
                reports_url = f"/api/projects/{project_id}/reports"
                return wrap_jsonapi_list("reports", items, reports_url, len(items), None, False), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_report(project_id: str, project: dict | None = None, **kwargs) -> tuple[dict, int]:
        result = await _uc().create_report(project_id=project_id, project=project, **kwargs)
        match result:
            case Success(data):
                serialized = serialize(data)
                link = f"/api/projects/{project_id}/reports/{serialized['id']}"
                return wrap_jsonapi_single("reports", serialized, link), 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_report(report_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().get_report(report_id, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("reports", serialize(data), f"/api/reports/{report_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_report(report_id: str, project: dict | None = None, **kwargs) -> tuple[dict, int]:
        result = await _uc().update_report(report_id, kwargs, project=project)
        match result:
            case Success(data):
                return wrap_jsonapi_single("reports", serialize(data), f"/api/reports/{report_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def delete_report(report_id: str, project: dict | None = None) -> tuple[dict, int]:
        result = await _uc().delete_report(report_id, project=project)
        match result:
            case Success(data):
                return {"meta": {"deleted": data}}, 200
            case Failure(error):
                return error_response(error)
