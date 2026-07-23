"""SourceController — use-case dependency injection at the controller seam.

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

from app.controllers.source_controller import SourceController
from app.use_cases.source.exceptions import SourceNotFound


async def test_patch_source_archived__when_use_case_succeeds__returns_200_with_cold_storage_envelope():
    async def fake_archive_source(source_id, *, archived):
        return Success(
            {
                "id": "src-1",
                "project_id": "proj-1",
                "name": "Patients",
                "archived_at": "2026-07-22T12:00:00",
                "retention_until": "2026-10-20T12:00:00",
            }
        )

    result = await SourceController.patch_source_archived("src-1", True, archive_source_func=fake_archive_source)

    assert result == (
        {
            "data": {
                "type": "sources",
                "id": "src-1",
                "attributes": {
                    "project_id": "proj-1",
                    "name": "Patients",
                    "archived_at": "2026-07-22T12:00:00",
                    "retention_until": "2026-10-20T12:00:00",
                },
            },
            "links": {"self": "/api/sources/src-1"},
        },
        200,
    )


async def test_patch_source_archived__when_source_not_found__returns_404_error_envelope():
    async def fake_archive_source(source_id, *, archived):
        return Failure(SourceNotFound(source_id))

    result = await SourceController.patch_source_archived("missing", True, archive_source_func=fake_archive_source)

    assert result == (
        {"errors": [{"status": "404", "title": "Source Not Found", "detail": "Source with ID 'missing' not found"}]},
        404,
    )


async def test_post_source__when_use_case_succeeds__returns_201_created_envelope():
    async def fake_create_source(*, project_id, name, schema_config, user):
        return Success({"id": "src-9", "project_id": project_id, "name": name})

    result = await SourceController.post_source(
        project_id="proj-1", name="Patients", create_source_func=fake_create_source
    )

    assert result == (
        {
            "data": {
                "type": "sources",
                "id": "src-9",
                "attributes": {"project_id": "proj-1", "name": "Patients"},
            },
            "links": {"self": "/api/sources/src-9"},
        },
        201,
    )
