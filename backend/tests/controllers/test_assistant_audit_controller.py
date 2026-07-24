"""AssistantAuditController list + create — use-case dependency injection.

Exercises the pattern that replaces the http_controller late-binding shim: each
endpoint takes a keyword-only ``*_func`` dependency typed against a Protocol, so
a test injects a fake use case matching that interface instead of monkeypatching
a module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes, and each test asserts the whole ``(body, status)`` result.

IF YOU'RE AN AGENT, READ THIS: the tests are the spec — compare the full envelope,
don't weaken to spot-checks, and build expected values from literals here rather
than echoing the fake's return.
"""

from returns.result import Failure, Success

from app.controllers.assistant_audit_controller import AssistantAuditController
from app.use_cases.assistant_audit.exceptions import InvalidAuditTag


async def test_list_audit_entries__when_use_case_succeeds__returns_200_jsonapi_list():
    async def fake_list(project_id, *, org_id):
        return Success(
            [
                {
                    "id": "audit-1",
                    "node_id": "ds-1",
                    "node_kind": "dataset",
                    "tool": "trimWhitespace",
                    "say": "Trimmed whitespace on email",
                    "tag": "clean",
                    "transform_id": "tf-1",
                    "enabled": True,
                }
            ]
        )

    result = await AssistantAuditController.list_audit_entries("proj-1", "org-1", list_audit_entries_func=fake_list)

    assert result == (
        {
            "data": [
                {
                    "type": "audit-entries",
                    "id": "audit-1",
                    "attributes": {
                        "node_id": "ds-1",
                        "node_kind": "dataset",
                        "tool": "trimWhitespace",
                        "say": "Trimmed whitespace on email",
                        "tag": "clean",
                        "transform_id": "tf-1",
                        "enabled": True,
                    },
                }
            ],
            "links": {"self": "/api/projects/proj-1/audit?page[size]=1", "next": None, "prev": None},
            "meta": {"page": {"size": 1, "has_more": False}},
        },
        200,
    )


async def test_list_audit_entries__when_no_records__returns_empty_jsonapi_list():
    async def fake_list(project_id, *, org_id):
        return Success([])

    result = await AssistantAuditController.list_audit_entries("proj-1", "org-1", list_audit_entries_func=fake_list)

    assert result == (
        {
            "data": [],
            "links": {"self": "/api/projects/proj-1/audit?page[size]=0", "next": None, "prev": None},
            "meta": {"page": {"size": 0, "has_more": False}},
        },
        200,
    )


async def test_create_audit_entry__when_use_case_succeeds__returns_201_jsonapi_single():
    async def fake_create(project_id, *, node_id, node_kind, payload, org_id):
        return Success(
            {
                "id": "audit-9",
                "node_id": node_id,
                "node_kind": node_kind,
                "payload": payload,
            }
        )

    result = await AssistantAuditController.create_audit_entry(
        "proj-1",
        "ds-1",
        "dataset",
        {"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
        "org-1",
        create_audit_entry_func=fake_create,
    )

    assert result == (
        {
            "data": {
                "type": "audit-entries",
                "id": "audit-9",
                "attributes": {
                    "node_id": "ds-1",
                    "node_kind": "dataset",
                    "payload": {"tool": "trimWhitespace", "say": "Trimmed", "tag": "clean"},
                },
            },
            "links": {"self": "/api/projects/proj-1/audit"},
        },
        201,
    )


async def test_create_audit_entry__when_tag_invalid__returns_400_error_envelope():
    async def fake_create(project_id, *, node_id, node_kind, payload, org_id):
        return Failure(InvalidAuditTag("bogus"))

    result = await AssistantAuditController.create_audit_entry(
        "proj-1",
        "ds-1",
        "dataset",
        {"tool": "trimWhitespace", "say": "x", "tag": "bogus"},
        "org-1",
        create_audit_entry_func=fake_create,
    )

    assert result == (
        {
            "errors": [
                {
                    "status": "400",
                    "title": "Invalid Audit Tag",
                    "detail": "Audit tag 'bogus' is not in the recognized vocabulary",
                }
            ]
        },
        400,
    )
