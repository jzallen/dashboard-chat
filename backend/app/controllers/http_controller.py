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
from .dataset_controller import DatasetController
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

    # Dataset methods — delegated to DatasetController (Seam 1)
    list_datasets = staticmethod(DatasetController.list_datasets)
    list_project_datasets = staticmethod(DatasetController.list_project_datasets)
    get_dataset = staticmethod(DatasetController.get_dataset)
    patch_dataset = staticmethod(DatasetController.patch_dataset)
    post_dataset = staticmethod(DatasetController.post_dataset)
    post_upload = staticmethod(DatasetController.post_upload)
    post_transforms = staticmethod(DatasetController.post_transforms)
    patch_transforms = staticmethod(DatasetController.patch_transforms)
    preview_transform = staticmethod(DatasetController.preview_transform)
    search_datasets = staticmethod(DatasetController.search_datasets)

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
