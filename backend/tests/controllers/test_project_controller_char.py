"""Characterization tests — Seam 2: Project & Workspace controller.

Pins the CURRENT observable behavior of the project endpoints on HTTPController
(L200-257). These tests must remain green after extraction to
`project_controller.py`.

Existing coverage in test_http_controller.py covers:
- TestListProjects (success 200 / 500)
- TestGetProject (success 200 / 404)
- TestPostProject (success 201)
- TestPatchProject (success 200 / 404)
- TestDeleteProject (success 200 / 404)

Gaps pinned here:
- list_projects forwards `user` and cursor/page_size kwargs.
- post_project forwards `description` and `user`.
- patch_project forwards `**kwargs` (the update body) and `project` context.
- delete_project forwards `user` and `project`.
- delete body shape `{meta: {deleted: <bool>}}` precisely.
- post_project self-link contains new project id.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.project.exceptions import ProjectNotFound


@dataclass
class _Model:
    id: str
    name: str = "thing"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# list_projects — forward user + cursor + page_size (L201-216)
# ---------------------------------------------------------------------------


class TestListProjectsForwarding:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_forwards_user_cursor_page_size(self, mock_uc):
        mock_uc.list_projects = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 25,
                }
            )
        )
        await HTTPController.list_projects(
            cursor="IN", page_size=25, base_url="/api/p", user="USER_SENTINEL"
        )
        mock_uc.list_projects.assert_awaited_once_with(
            user="USER_SENTINEL", cursor="IN", page_size=25
        )

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_envelope_uses_base_url(self, mock_uc):
        mock_uc.list_projects = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 50,
                }
            )
        )
        body, _ = await HTTPController.list_projects(base_url="/api/custom-projects")
        assert "/api/custom-projects" in body["links"]["self"]


# ---------------------------------------------------------------------------
# post_project — forward description + user (L227-235)
# ---------------------------------------------------------------------------


class TestPostProjectForwarding:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_forwards_name_description_user(self, mock_uc):
        mock_uc.create_project = AsyncMock(return_value=Success(_Model("p1", "Name")))
        await HTTPController.post_project(
            "Name", description="Desc", user="USER_SENTINEL"
        )
        mock_uc.create_project.assert_awaited_once_with(
            name="Name", description="Desc", user="USER_SENTINEL"
        )

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_self_link_contains_new_project_id(self, mock_uc):
        mock_uc.create_project = AsyncMock(
            return_value=Success(_Model("NEW-P-ID", "Fresh"))
        )
        body, status = await HTTPController.post_project("Fresh")
        assert status == 201
        assert body["links"]["self"] == "/api/projects/NEW-P-ID"


# ---------------------------------------------------------------------------
# patch_project — forward kwargs body + project context (L237-246)
# ---------------------------------------------------------------------------


class TestPatchProjectForwarding:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_forwards_kwargs_as_update_body(self, mock_uc):
        mock_uc.update_project = AsyncMock(
            return_value=Success(_Model("p1", "Updated"))
        )
        await HTTPController.patch_project(
            "p1",
            user="U",
            project={"id": "p1"},
            name="Updated",
            description="New",
        )
        mock_uc.update_project.assert_awaited_once_with(
            "p1",
            {"name": "Updated", "description": "New"},
            user="U",
            project={"id": "p1"},
        )


# ---------------------------------------------------------------------------
# delete_project — body shape + forwarding (L248-257)
# ---------------------------------------------------------------------------


class TestDeleteProjectBodyAndForwarding:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_body_is_meta_deleted_true(self, mock_uc):
        mock_uc.delete_project = AsyncMock(return_value=Success(True))
        body, status = await HTTPController.delete_project("p1")
        assert status == 200
        assert body == {"meta": {"deleted": True}}

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_body_is_meta_deleted_false_when_use_case_returns_false(
        self, mock_uc
    ):
        """The controller does NOT interpret truthiness — it pipes through
        whatever the use case returned. Characterize this verbatim."""
        mock_uc.delete_project = AsyncMock(return_value=Success(False))
        body, status = await HTTPController.delete_project("p1")
        assert status == 200
        assert body == {"meta": {"deleted": False}}

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_forwards_user_and_project(self, mock_uc):
        mock_uc.delete_project = AsyncMock(return_value=Success(True))
        await HTTPController.delete_project(
            "p1", user="USER_SENTINEL", project={"id": "p1"}
        )
        mock_uc.delete_project.assert_awaited_once_with(
            "p1", user="USER_SENTINEL", project={"id": "p1"}
        )

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.delete_project = AsyncMock(
            return_value=Failure(ProjectNotFound("p1"))
        )
        _, status = await HTTPController.delete_project("p1")
        assert status == 404
