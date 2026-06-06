"""HTTP controller facade — delegates to per-context controllers.

After the dc-e65d DDD refactor, this file is a thin facade composed entirely
of:
  1. Use-case module aliases (imported at module level) that exist ONLY for
     test-patch compatibility — `test_http_controller.py` and the
     per-context characterization tests patch
     `app.controllers.http_controller.<alias>` expecting the name to live on
     this module. Per-context controllers read these aliases off this module
     at call time (see e.g. `DatasetController._dataset_uc()`), so patches
     flow through naturally.
  2. Legacy `_serialize` / `_error_response` re-exports from
     `_result_mapper` — kept because `test_http_controller.py`,
     `test_result_mapper_char.py`, and `tests/integration/test_upload_pipeline.py`
     import them by those names from this module.
  3. `HTTPController` — class whose methods are staticmethod re-exports
     pointing at the per-context controllers. All router call-sites use this
     class; signatures are unchanged from pre-refactor.

See `docs/feature/http-controller-ddd-refactor/design/domain/seams.md` for the extraction plan.

Do NOT remove any of the module-level aliases until the tests that patch
them are rewritten to patch the per-context controllers directly.
"""

# --- Use-case module aliases (retained for test patching) ---------------
from app.use_cases import assistant_audit as assistant_audit_use_cases  # noqa: F401
from app.use_cases import dataset as dataset_use_cases  # noqa: F401
from app.use_cases import organization as organization_use_cases  # noqa: F401
from app.use_cases import project as project_use_cases  # noqa: F401
from app.use_cases import query_engine as query_engine_use_cases  # noqa: F401
from app.use_cases import report as report_use_cases  # noqa: F401
from app.use_cases import sql_access as sql_access_use_cases  # noqa: F401
from app.use_cases import upload as upload_use_cases  # noqa: F401
from app.use_cases import view as view_use_cases  # noqa: F401
from app.use_cases.dataset import search_datasets as search_datasets_uc  # noqa: F401
from app.use_cases.exceptions import DomainException  # noqa: F401
from app.use_cases.memory import get_project_memory as get_project_memory_uc  # noqa: F401
from app.use_cases.session import create_session as create_session_uc  # noqa: F401
from app.use_cases.session import get_session as get_session_uc  # noqa: F401
from app.use_cases.session import list_session_events as list_session_events_uc  # noqa: F401
from app.use_cases.session import list_sessions as list_sessions_uc  # noqa: F401
from app.use_cases.session import update_session as update_session_uc  # noqa: F401

# --- Legacy helper re-exports (tests import these names from here) ------
from ._result_mapper import error_response as _error_response  # noqa: F401
from ._result_mapper import serialize as _serialize  # noqa: F401
from .assistant_audit_controller import AssistantAuditController

# --- Per-context controller composition ---------------------------------
from .conversation_controller import ConversationController
from .dataset_controller import DatasetController
from .organization_controller import OrganizationController
from .project_controller import ProjectController
from .query_engine_controller import QueryEngineController
from .report_controller import ReportController
from .sql_access_controller import SQLAccessController
from .view_controller import ViewController


class HTTPController:
    """Facade composing per-context HTTP controllers.

    Returns `tuple[dict, int]` — JSON:API envelope body and status code.
    All behavior lives in the per-context controller classes under
    `app/controllers/`.
    """

    # Dataset Ingestion (Seam 1)
    list_datasets = staticmethod(DatasetController.list_datasets)
    list_project_datasets = staticmethod(DatasetController.list_project_datasets)
    get_dataset = staticmethod(DatasetController.get_dataset)
    patch_dataset = staticmethod(DatasetController.patch_dataset)
    archive_dataset = staticmethod(DatasetController.archive_dataset)
    restore_dataset = staticmethod(DatasetController.restore_dataset)
    post_dataset = staticmethod(DatasetController.post_dataset)
    post_upload = staticmethod(DatasetController.post_upload)
    post_transforms = staticmethod(DatasetController.post_transforms)
    patch_transforms = staticmethod(DatasetController.patch_transforms)
    preview_transform = staticmethod(DatasetController.preview_transform)
    search_datasets = staticmethod(DatasetController.search_datasets)

    # Project & Workspace (Seam 2)
    list_projects = staticmethod(ProjectController.list_projects)
    get_project = staticmethod(ProjectController.get_project)
    post_project = staticmethod(ProjectController.post_project)
    patch_project = staticmethod(ProjectController.patch_project)
    delete_project = staticmethod(ProjectController.delete_project)

    # Conversation / Session + Memory (Seam 3)
    get_project_memory = staticmethod(ConversationController.get_project_memory)
    post_session = staticmethod(ConversationController.post_session)
    list_sessions = staticmethod(ConversationController.list_sessions)
    list_session_events = staticmethod(ConversationController.list_session_events)
    get_session = staticmethod(ConversationController.get_session)
    patch_session = staticmethod(ConversationController.patch_session)

    # Identity / Organization (Seam 4)
    post_organization = staticmethod(OrganizationController.post_organization)
    get_my_organization = staticmethod(OrganizationController.get_my_organization)

    # Assistant audit — read (rich-catalog §2.11) + create (§2.7)
    list_audit_entries = staticmethod(AssistantAuditController.list_audit_entries)
    create_audit_entry = staticmethod(AssistantAuditController.create_audit_entry)

    # Analytics Authoring — Views (Seam 5a)
    list_views = staticmethod(ViewController.list_views)
    post_view = staticmethod(ViewController.post_view)
    get_view = staticmethod(ViewController.get_view)
    patch_view = staticmethod(ViewController.patch_view)
    delete_view = staticmethod(ViewController.delete_view)

    # Analytics Authoring — Reports (Seam 5b)
    list_reports = staticmethod(ReportController.list_reports)
    post_report = staticmethod(ReportController.post_report)
    get_report = staticmethod(ReportController.get_report)
    patch_report = staticmethod(ReportController.patch_report)
    delete_report = staticmethod(ReportController.delete_report)

    # External SQL Access Provisioning (Seam 6)
    enable_sql_access = staticmethod(SQLAccessController.enable_sql_access)
    disable_sql_access = staticmethod(SQLAccessController.disable_sql_access)
    get_sql_access = staticmethod(SQLAccessController.get_sql_access)
    sync_sql_access = staticmethod(SQLAccessController.sync_sql_access)
    regenerate_sql_credentials = staticmethod(SQLAccessController.regenerate_sql_credentials)

    # Query Engine Fleet Admin (Seam 7)
    list_query_engines = staticmethod(QueryEngineController.list_query_engines)
    get_query_engine = staticmethod(QueryEngineController.get_query_engine)
    test_query_engine = staticmethod(QueryEngineController.test_query_engine)
