"""ProjectController — use-case dependency injection at the controller seam.

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

from app.controllers.project_controller import ProjectController
from app.use_cases.project.exceptions import ProjectNotFound


async def test_list_projects__when_use_case_succeeds__returns_200_with_paginated_envelope():
    async def fake_list_projects(*, user, cursor, page_size):
        return Success(
            {
                "items": [{"id": "proj-1", "name": "Patients", "datasets": []}],
                "next_cursor": None,
                "has_more": False,
                "page_size": 50,
            }
        )

    result = await ProjectController.list_projects(list_projects_func=fake_list_projects)

    assert result == (
        {
            "data": [
                {
                    "type": "projects",
                    "id": "proj-1",
                    "attributes": {"name": "Patients", "datasets": []},
                }
            ],
            "links": {"self": "/api/projects?page[size]=50", "next": None, "prev": None},
            "meta": {"page": {"size": 50, "has_more": False}},
        },
        200,
    )


async def test_get_project__when_use_case_succeeds__returns_200_with_single_envelope():
    async def fake_get_project(project_id, *, user):
        return Success({"id": "proj-1", "name": "Patients"})

    result = await ProjectController.get_project("proj-1", get_project_func=fake_get_project)

    assert result == (
        {
            "data": {
                "type": "projects",
                "id": "proj-1",
                "attributes": {"name": "Patients"},
            },
            "links": {"self": "/api/projects/proj-1"},
        },
        200,
    )


async def test_get_project__when_project_not_found__returns_404_error_envelope():
    async def fake_get_project(project_id, *, user):
        return Failure(ProjectNotFound(project_id))

    result = await ProjectController.get_project("missing", get_project_func=fake_get_project)

    assert result == (
        {"errors": [{"status": "404", "title": "Project Not Found", "detail": "Project with ID 'missing' not found"}]},
        404,
    )


async def test_post_project__when_use_case_succeeds__returns_201_created_envelope():
    async def fake_create_project(*, name, description, user):
        return Success({"id": "proj-9", "name": name, "description": description})

    result = await ProjectController.post_project(
        "Patients", description="PHI", create_project_func=fake_create_project
    )

    assert result == (
        {
            "data": {
                "type": "projects",
                "id": "proj-9",
                "attributes": {"name": "Patients", "description": "PHI"},
            },
            "links": {"self": "/api/projects/proj-9"},
        },
        201,
    )


async def test_patch_project__when_use_case_succeeds__returns_200_with_updated_envelope():
    async def fake_update_project(project_id, update_data, *, user, project):
        return Success({"id": project_id, **update_data})

    result = await ProjectController.patch_project("proj-1", name="Renamed", update_project_func=fake_update_project)

    assert result == (
        {
            "data": {
                "type": "projects",
                "id": "proj-1",
                "attributes": {"name": "Renamed"},
            },
            "links": {"self": "/api/projects/proj-1"},
        },
        200,
    )


async def test_delete_project__when_use_case_succeeds__returns_200_with_deleted_meta():
    async def fake_delete_project(project_id, *, user, project):
        return Success(True)

    result = await ProjectController.delete_project("proj-1", delete_project_func=fake_delete_project)

    assert result == ({"meta": {"deleted": True}}, 200)
