"""Assistant-audit HTTP controller — rich-catalog §2.11.

Thin HTTP adapter for the read that backs the UI's ``getAudit``. Delegates to
``app/use_cases/assistant_audit`` and emits a JSON:API list whose item attributes
carry ``node_id``/``node_kind`` + ``tool``/``say``/``tag`` (from the entry's JSON
payload) + ``transform_id``/``enabled`` (from the reversed-FK join). Mirrors the
project-scoped list controllers (e.g. :class:`ViewController`).

The ``assistant_audit_use_cases`` alias is read off ``http_controller`` at call
time so test patches on
``app.controllers.http_controller.assistant_audit_use_cases`` continue to
intercept.
"""

from typing import Any

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


def _uc():
    from app.controllers import http_controller

    return http_controller.assistant_audit_use_cases


class AssistantAuditController:
    """Controller for the assistant-audit read + create endpoints."""

    @staticmethod
    async def list_audit_entries(project_id: str, org_id: str) -> tuple[dict, int]:
        result = await _uc().list_audit_entries_for_project(project_id, org_id=org_id)
        match result:
            case Success(data):
                items = serialize(data)
                url = f"/api/projects/{project_id}/audit"
                return wrap_jsonapi_list("audit-entries", items, url, len(items), None, False), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def toggle_audit_entry(
        assistant_audit_entry_id: str,
        enabled: bool,
        org_id: str,
    ) -> tuple[dict, int]:
        """Toggle a transform-type audit entry (rich-catalog §2.5-2.6).

        Enables/disables the Transform pointing UP at the entry and returns the
        toggled entry as a JSON:API single (so the UI knows which node's audit to
        revalidate). 409 for log-only entries, 404 for out-of-scope/missing.
        """
        result = await _uc().toggle_audit_entry(
            assistant_audit_entry_id,
            enabled=enabled,
            org_id=org_id,
        )
        match result:
            case Success(record):
                url = f"/api/projects/{record['project_id']}/audit/{record['id']}"
                return wrap_jsonapi_single("audit-entries", serialize(record), url), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def create_audit_entry(
        project_id: str,
        node_id: str,
        node_kind: str,
        payload: dict[str, Any],
        org_id: str,
    ) -> tuple[dict, int]:
        """Create an assistant-audit entry (rich-catalog §2.7 Option A)."""
        result = await _uc().create_audit_entry(
            project_id,
            node_id=node_id,
            node_kind=node_kind,
            payload=payload,
            org_id=org_id,
        )
        match result:
            case Success(record):
                url = f"/api/projects/{project_id}/audit"
                return wrap_jsonapi_single("audit-entries", serialize(record), url), 201
            case Failure(error):
                return error_response(error)
