"""Characterization tests — Seam 2: Project & Workspace controller.

Pins the observable forwarding behavior of the project endpoints. Originally
written against the ``HTTPController`` roll-up (which patched the
``project_use_cases`` module alias); reconciled to the use-case injection seam
after DC-202 — each test now injects a fake use case via the controller's
keyword-only ``*_func`` dependency and calls ``ProjectController`` directly.
The behavioral assertions are unchanged.

Gaps pinned here (beyond the happy paths in test_project_controller.py):
- list_projects forwards `user` and cursor/page_size kwargs.
- post_project forwards `description` and `user`.
- patch_project forwards `**kwargs` (the update body) and `project` context.
- delete_project forwards `user` and `project`.
- delete body shape `{meta: {deleted: <bool>}}` precisely.
- post_project self-link contains new project id.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

from returns.result import Failure, Success

from app.controllers.project_controller import ProjectController
from app.use_cases.project.exceptions import ProjectNotFound


@dataclass
class _Model:
    id: str
    name: str = "thing"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# list_projects — forward user + cursor + page_size
# ---------------------------------------------------------------------------


class TestListProjectsForwarding:
    async def test_forwards_user_cursor_page_size(self):
        fake = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 25,
                }
            )
        )
        await ProjectController.list_projects(
            cursor="IN", page_size=25, user="USER_SENTINEL", list_projects_func=fake
        )
        fake.assert_awaited_once_with(user="USER_SENTINEL", cursor="IN", page_size=25)


# ---------------------------------------------------------------------------
# post_project — forward description + user
# ---------------------------------------------------------------------------


class TestPostProjectForwarding:
    async def test_forwards_name_description_user(self):
        fake = AsyncMock(return_value=Success(_Model("p1", "Name")))
        await ProjectController.post_project("Name", description="Desc", user="USER_SENTINEL", create_project_func=fake)
        fake.assert_awaited_once_with(name="Name", description="Desc", user="USER_SENTINEL")

    async def test_self_link_contains_new_project_id(self):
        fake = AsyncMock(return_value=Success(_Model("NEW-P-ID", "Fresh")))
        body, status = await ProjectController.post_project("Fresh", create_project_func=fake)
        assert status == 201
        assert body["links"]["self"] == "/api/projects/NEW-P-ID"


# ---------------------------------------------------------------------------
# patch_project — forward kwargs body + project context
# ---------------------------------------------------------------------------


class TestPatchProjectForwarding:
    async def test_forwards_kwargs_as_update_body(self):
        fake = AsyncMock(return_value=Success(_Model("p1", "Updated")))
        await ProjectController.patch_project(
            "p1",
            user="U",
            project={"id": "p1"},
            name="Updated",
            description="New",
            update_project_func=fake,
        )
        fake.assert_awaited_once_with(
            "p1",
            {"name": "Updated", "description": "New"},
            user="U",
            project={"id": "p1"},
        )


# ---------------------------------------------------------------------------
# delete_project — body shape + forwarding
# ---------------------------------------------------------------------------


class TestDeleteProjectBodyAndForwarding:
    async def test_body_is_meta_deleted_true(self):
        fake = AsyncMock(return_value=Success(True))
        body, status = await ProjectController.delete_project("p1", delete_project_func=fake)
        assert status == 200
        assert body == {"meta": {"deleted": True}}

    async def test_body_is_meta_deleted_false_when_use_case_returns_false(self):
        """The controller does NOT interpret truthiness — it pipes through
        whatever the use case returned. Characterize this verbatim."""
        fake = AsyncMock(return_value=Success(False))
        body, status = await ProjectController.delete_project("p1", delete_project_func=fake)
        assert status == 200
        assert body == {"meta": {"deleted": False}}

    async def test_forwards_user_and_project(self):
        fake = AsyncMock(return_value=Success(True))
        await ProjectController.delete_project(
            "p1", user="USER_SENTINEL", project={"id": "p1"}, delete_project_func=fake
        )
        fake.assert_awaited_once_with("p1", user="USER_SENTINEL", project={"id": "p1"})

    async def test_not_found_returns_404(self):
        fake = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        _, status = await ProjectController.delete_project("p1", delete_project_func=fake)
        assert status == 404
