"""Assistant-audit HTTP controller — rich-catalog §2.11.

Thin HTTP adapter for the reads/writes that back the UI's ``getAudit``. The
router depends on this class directly — there is deliberately no roll-up through
a god ``HTTPController``.

Each endpoint declares its use case as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.assistant_audit``, typed against a ``Protocol`` that captures the
call interface the controller relies on. Production passes nothing (the defaults
bind); tests inject a function matching the Protocol instead of monkeypatching a
module-level alias. This is the seam that replaces the ``_uc()`` late-binding
shim inherited from the http_controller DDD refactor.

Emits a JSON:API list whose item attributes carry ``node_id``/``node_kind`` +
``tool``/``say``/``tag`` (from the entry's JSON payload) + ``transform_id``/
``enabled`` (from the reversed-FK join). Mirrors the project-scoped list
controllers (e.g. :class:`ViewController`).
"""

from typing import Any, Protocol

from returns.result import Failure, Result, Success

from app.use_cases import assistant_audit as assistant_audit_use_cases

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


class ListAuditEntriesProtocol(Protocol):
    """Call interface for the list-audit-entries use case."""

    async def __call__(self, project_id: str, *, org_id: str) -> Result: ...


class CreateAuditEntryProtocol(Protocol):
    """Call interface for the create-audit-entry use case."""

    async def __call__(
        self,
        project_id: str,
        *,
        node_id: str,
        node_kind: str,
        payload: dict[str, Any],
        org_id: str,
    ) -> Result: ...


class ToggleAuditEntryProtocol(Protocol):
    """Call interface for the toggle-audit-entry use case."""

    async def __call__(
        self,
        assistant_audit_entry_id: str,
        *,
        enabled: bool,
        org_id: str,
    ) -> Result: ...


class AssistantAuditController:
    """Controller for the assistant-audit read + create + toggle endpoints."""

    @staticmethod
    async def list_audit_entries(
        project_id: str,
        org_id: str,
        *,
        list_audit_entries_func: ListAuditEntriesProtocol = assistant_audit_use_cases.list_audit_entries_for_project,
    ) -> tuple[dict, int]:
        result = await list_audit_entries_func(project_id, org_id=org_id)
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
        *,
        toggle_audit_entry_func: ToggleAuditEntryProtocol = assistant_audit_use_cases.toggle_audit_entry,
    ) -> tuple[dict, int]:
        """Toggle a transform-type audit entry (rich-catalog §2.5-2.6).

        Enables/disables the Transform pointing UP at the entry and returns the
        toggled entry as a JSON:API single (so the UI knows which node's audit to
        revalidate). 409 for log-only entries, 404 for out-of-scope/missing.
        """
        result = await toggle_audit_entry_func(
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
        *,
        create_audit_entry_func: CreateAuditEntryProtocol = assistant_audit_use_cases.create_audit_entry,
    ) -> tuple[dict, int]:
        """Create an assistant-audit entry (rich-catalog §2.7 Option A)."""
        result = await create_audit_entry_func(
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
