"""AssistantAuditController toggle (rich-catalog §2.6) — use-case injection.

Exercises the DI seam that replaces the http_controller late-binding shim: the
endpoint takes a keyword-only ``toggle_audit_entry_func`` dependency typed against
a Protocol, so a test injects a fake use case instead of monkeypatching a
module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes, and each test asserts the whole ``(body, status)`` result.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec — compare the full envelope,
don't weaken to spot-checks, and build expected values from literals here rather
than echoing the fake's return.
"""

from returns.result import Failure, Success

from app.controllers.assistant_audit_controller import AssistantAuditController
from app.use_cases.assistant_audit.exceptions import AuditEntryNotFound, AuditEntryNotToggleable


async def test_toggle_audit_entry__when_use_case_succeeds__returns_200_jsonapi_single():
    async def fake_toggle(assistant_audit_entry_id, *, enabled, org_id):
        return Success(
            {
                "id": "audit-1",
                "project_id": "proj-1",
                "node_id": "ds-1",
                "node_kind": "dataset",
            }
        )

    result = await AssistantAuditController.toggle_audit_entry(
        "audit-1", False, "org-1", toggle_audit_entry_func=fake_toggle
    )

    assert result == (
        {
            "data": {
                "type": "audit-entries",
                "id": "audit-1",
                "attributes": {
                    "project_id": "proj-1",
                    "node_id": "ds-1",
                    "node_kind": "dataset",
                },
            },
            "links": {"self": "/api/projects/proj-1/audit/audit-1"},
        },
        200,
    )


async def test_toggle_audit_entry__when_log_only__returns_409_error_envelope():
    async def fake_toggle(assistant_audit_entry_id, *, enabled, org_id):
        return Failure(AuditEntryNotToggleable("audit-2"))

    result = await AssistantAuditController.toggle_audit_entry(
        "audit-2", False, "org-1", toggle_audit_entry_func=fake_toggle
    )

    assert result == (
        {
            "errors": [
                {
                    "status": "409",
                    "title": "Audit Entry Not Toggleable",
                    "detail": "Audit entry 'audit-2' has no transform to toggle (log-only)",
                }
            ]
        },
        409,
    )


async def test_toggle_audit_entry__when_out_of_scope__returns_404_error_envelope():
    async def fake_toggle(assistant_audit_entry_id, *, enabled, org_id):
        return Failure(AuditEntryNotFound("audit-1"))

    result = await AssistantAuditController.toggle_audit_entry(
        "audit-1", False, "other-org", toggle_audit_entry_func=fake_toggle
    )

    assert result == (
        {
            "errors": [
                {
                    "status": "404",
                    "title": "Audit Entry Not Found",
                    "detail": "Audit entry with ID 'audit-1' not found",
                }
            ]
        },
        404,
    )
