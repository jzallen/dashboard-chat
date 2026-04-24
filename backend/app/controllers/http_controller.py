"""HTTP controller for serializing domain models to JSON responses.

This module is the facade for the per-context controllers under
`app/controllers/` (see docs/feature/dc-e65d/design/domain/seams.md).
The module-level `<domain>_use_cases` aliases are intentionally retained so
that existing tests (which patch `app.controllers.http_controller.<alias>`)
continue to work as the per-context controllers read these aliases off this
module at call time. Do not remove the aliases until those tests are moved.
"""

import logging
from typing import Any

from returns.result import Failure, Success

from app.auth.types import AuthUser
from app.use_cases import dataset as dataset_use_cases
from app.use_cases import organization as organization_use_cases
from app.use_cases import project as project_use_cases
from app.use_cases import query_engine as query_engine_use_cases
from app.use_cases import report as report_use_cases
from app.use_cases import sql_access as sql_access_use_cases
from app.use_cases import upload as upload_use_cases
from app.use_cases import view as view_use_cases
from app.use_cases.dataset import search_datasets as search_datasets_uc
from app.use_cases.exceptions import DomainException  # noqa: F401 — kept for test compat
from app.use_cases.memory import get_project_memory as get_project_memory_uc
from app.use_cases.session import create_session as create_session_uc
from app.use_cases.session import list_sessions as list_sessions_uc
from app.use_cases.session import update_session as update_session_uc

from ._result_mapper import error_response as _error_response  # re-export for test compat
from ._result_mapper import serialize as _serialize  # re-export for test compat
from .conversation_controller import ConversationController
from .organization_controller import OrganizationController
from .project_controller import ProjectController
from .query_engine_controller import QueryEngineController
from .report_controller import ReportController
from .response_wrapper import wrap_jsonapi_error, wrap_jsonapi_list, wrap_jsonapi_single  # noqa: F401
from .sql_access_controller import SQLAccessController
from .view_controller import ViewController

logger = logging.getLogger(__name__)


class HTTPController:
    """Controller that serializes domain models for HTTP responses.

    Returns tuple[dict, int] — body and status code.
    """

    @staticmethod
    async def list_datasets(
        project_id: str,
        cursor: str | None = None,
        page_size: int = 50,
        base_url: str = "/api/datasets",
    ) -> tuple[dict, int]:
        result = await dataset_use_cases.list_datasets(project_id, cursor=cursor, page_size=page_size)
        match result:
            case Success(data):
                items = [_serialize(i) for i in data["items"]]
                resp = wrap_jsonapi_list(
                    "datasets", items, base_url, data["page_size"], data["next_cursor"], data["has_more"]
                )
                return resp, 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def list_project_datasets(
        project_id: str,
        cursor: str | None = None,
        page_size: int = 50,
        base_url: str = "/api/projects",
    ) -> tuple[dict, int]:
        result = await dataset_use_cases.list_datasets_for_project(project_id, cursor=cursor, page_size=page_size)
        match result:
            case Success(data):
                items = data["items"]
                url = f"{base_url}/{project_id}/datasets"
                resp = wrap_jsonapi_list(
                    "datasets", items, url, data["page_size"], data["next_cursor"], data["has_more"]
                )
                return resp, 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def get_dataset(
        dataset_id: str, include_transforms: bool = True, include_preview: bool = False, preview_limit: int = 10
    ) -> tuple[dict, int]:
        result = await dataset_use_cases.get_dataset(dataset_id, include_transforms, include_preview, preview_limit)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", _serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def patch_dataset(dataset_id: str, **kwargs) -> tuple[dict, int]:
        result = await dataset_use_cases.update_dataset(dataset_id, kwargs)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", _serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def post_dataset(
        upload_id: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
        plugin_registry=None,
        choices: dict[str, str] | None = None,
    ) -> tuple[dict, int]:
        result = await dataset_use_cases.create_dataset_from_upload(
            upload_id=upload_id,
            partition_fields=partition_fields,
            description=description,
            plugin_registry=plugin_registry,
            choices=choices,
        )
        match result:
            case Success(data):
                serialized = _serialize(data)
                return wrap_jsonapi_single("datasets", serialized, f"/api/datasets/{serialized['id']}"), 201
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def post_upload(
        file_content: bytes,
        file_name: str,
        project_id: str,
        plugin_registry=None,
        dataset_id: str | None = None,
        project: dict | None = None,
    ) -> tuple[dict, int]:
        result = await upload_use_cases.upload_file(
            file_content=file_content,
            file_name=file_name,
            project_id=project_id,
            plugin_registry=plugin_registry,
            dataset_id=dataset_id,
            project=project,
        )
        match result:
            case Success(data):
                serialized = _serialize(data)
                return wrap_jsonapi_single("uploads", serialized, f"/api/uploads/{serialized['id']}"), 201
            case Failure(error):
                return _error_response(error)

    # Transform methods

    @staticmethod
    async def post_transforms(dataset_id: str, transforms: list[dict]) -> tuple[dict, int]:
        result = await dataset_use_cases.create_transforms(dataset_id, transforms)
        match result:
            case Success():
                return {"ok": True}, 201
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def patch_transforms(dataset_id: str, updates: list[dict]) -> tuple[dict, int]:
        result = await dataset_use_cases.update_transforms(dataset_id, updates)
        match result:
            case Success():
                return {"ok": True}, 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def preview_transform(dataset_id: str, target_column: str, expression_config: dict) -> tuple[dict, int]:
        result = await dataset_use_cases.preview_cleaning_transform(dataset_id, target_column, expression_config)
        match result:
            case Success(data):
                return {"data": data}, 200
            case Failure(error):
                return _error_response(error)

    # Project methods — delegated to ProjectController (Seam 2)
    list_projects = staticmethod(ProjectController.list_projects)
    get_project = staticmethod(ProjectController.get_project)
    post_project = staticmethod(ProjectController.post_project)
    patch_project = staticmethod(ProjectController.patch_project)
    delete_project = staticmethod(ProjectController.delete_project)

    # Conversation methods — delegated to ConversationController (Seam 3)
    get_project_memory = staticmethod(ConversationController.get_project_memory)
    post_session = staticmethod(ConversationController.post_session)
    list_sessions = staticmethod(ConversationController.list_sessions)
    patch_session = staticmethod(ConversationController.patch_session)

    # Dataset search

    @staticmethod
    async def search_datasets(project_id: str, query: str, user: AuthUser) -> tuple[dict, int]:
        result = await search_datasets_uc.search_datasets(project_id, query, user=user)
        match result:
            case Success(data):
                return {"data": data}, 200
            case Failure(error):
                return _error_response(error)

    # Organization methods — delegated to OrganizationController (Seam 4)
    post_organization = staticmethod(OrganizationController.post_organization)
    get_my_organization = staticmethod(OrganizationController.get_my_organization)

    # View methods — delegated to ViewController (Seam 5a)
    list_views = staticmethod(ViewController.list_views)
    post_view = staticmethod(ViewController.post_view)
    get_view = staticmethod(ViewController.get_view)
    patch_view = staticmethod(ViewController.patch_view)
    delete_view = staticmethod(ViewController.delete_view)

    # Report methods — delegated to ReportController (Seam 5b)
    list_reports = staticmethod(ReportController.list_reports)
    post_report = staticmethod(ReportController.post_report)
    get_report = staticmethod(ReportController.get_report)
    patch_report = staticmethod(ReportController.patch_report)
    delete_report = staticmethod(ReportController.delete_report)

    # SQL access methods — delegated to SQLAccessController (Seam 6)
    enable_sql_access = staticmethod(SQLAccessController.enable_sql_access)
    disable_sql_access = staticmethod(SQLAccessController.disable_sql_access)
    get_sql_access = staticmethod(SQLAccessController.get_sql_access)
    sync_sql_access = staticmethod(SQLAccessController.sync_sql_access)
    regenerate_sql_credentials = staticmethod(SQLAccessController.regenerate_sql_credentials)

    # Query engine methods — delegated to QueryEngineController (Seam 7)
    list_query_engines = staticmethod(QueryEngineController.list_query_engines)
    get_query_engine = staticmethod(QueryEngineController.get_query_engine)
    test_query_engine = staticmethod(QueryEngineController.test_query_engine)
