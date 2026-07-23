"""SourceController — use-case dependency injection at the controller seam.

Exercises the pattern that replaces the http_controller late-binding shim: each
endpoint takes a keyword-only ``*_func`` dependency typed against a Protocol, so
a test injects a fake use case matching that interface instead of monkeypatching
a module-level alias. No database, no ASGI stack — the controller is unit-tested
against injected fakes.
"""

from returns.result import Failure, Success

from app.controllers.source_controller import SourceController
from app.use_cases.source.exceptions import SourceNotFound


class TestPatchSourceArchivedInjection:
    """patch_source_archived delegates to the injected archive_source function."""

    async def test_success_wraps_source_in_jsonapi_envelope(self):
        async def fake_archive_source(source_id, *, archived):
            assert (source_id, archived) == ("src-1", True)
            return Success(
                {
                    "id": "src-1",
                    "project_id": "proj-1",
                    "name": "Patients",
                    "archived_at": "2026-07-22T12:00:00",
                    "retention_until": "2026-10-20T12:00:00",
                }
            )

        body, status = await SourceController.patch_source_archived(
            "src-1", True, archive_source_func=fake_archive_source
        )

        assert status == 200
        assert body["data"]["type"] == "sources"
        assert body["data"]["id"] == "src-1"
        assert body["data"]["attributes"]["archived_at"] == "2026-07-22T12:00:00"

    async def test_failure_maps_domain_exception_to_status(self):
        async def fake_archive_source(source_id, *, archived):
            return Failure(SourceNotFound(source_id))

        body, status = await SourceController.patch_source_archived(
            "missing", True, archive_source_func=fake_archive_source
        )

        assert status == 404
        assert body["errors"][0]["title"] == "Source Not Found"


class TestPostSourceInjection:
    """post_source delegates to the injected create_source function."""

    async def test_success_returns_201_created_envelope(self):
        async def fake_create_source(*, project_id, name, schema_config, user):
            return Success({"id": "src-9", "project_id": project_id, "name": name})

        body, status = await SourceController.post_source(
            project_id="proj-1", name="Patients", create_source_func=fake_create_source
        )

        assert status == 201
        assert body["data"]["id"] == "src-9"
        assert body["data"]["attributes"]["name"] == "Patients"
