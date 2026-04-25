"""Characterization tests — Seam 3: Conversation (Session + Memory) controller.

Pins the CURRENT observable behavior of HTTPController.get_project_memory and
post/list/patch_session (L262-310). These tests must remain green after
extraction to `conversation_controller.py`.

No existing coverage in test_http_controller.py — everything here is new.
"""

from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.session.exceptions import SessionAccessDenied, SessionNotFound

# ---------------------------------------------------------------------------
# get_project_memory (L262-268) — JSON:API single, type='memories'
# ---------------------------------------------------------------------------


class TestGetProjectMemoryCharacterization:
    @patch("app.controllers.http_controller.get_project_memory_uc")
    async def test_success_returns_200_with_memory_envelope(self, mock_uc):
        mock_uc.get_project_memory = AsyncMock(return_value=Success({"id": "mem-1", "content": "hello"}))
        body, status = await HTTPController.get_project_memory("p1", user="USER_SENTINEL")
        assert status == 200
        assert body["data"]["type"] == "memories"
        assert body["data"]["id"] == "mem-1"
        assert body["data"]["attributes"] == {"content": "hello"}
        assert body["links"]["self"] == "/api/projects/p1/memory"

    @patch("app.controllers.http_controller.get_project_memory_uc")
    async def test_forwards_user(self, mock_uc):
        mock_uc.get_project_memory = AsyncMock(return_value=Success({"id": "mem-1"}))
        await HTTPController.get_project_memory("p1", user="USER_SENTINEL")
        mock_uc.get_project_memory.assert_awaited_once_with("p1", user="USER_SENTINEL")

    @patch("app.controllers.http_controller.get_project_memory_uc")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.get_project_memory = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        _, status = await HTTPController.get_project_memory("p1", user="U")
        assert status == 404


# ---------------------------------------------------------------------------
# post_session (L273-279) — 201 with nested self link
# ---------------------------------------------------------------------------


class TestPostSessionCharacterization:
    @patch("app.controllers.http_controller.create_session_uc")
    async def test_success_returns_201_with_nested_self_link(self, mock_uc):
        mock_uc.create_session = AsyncMock(return_value=Success({"id": "s-42", "title": "Chat"}))
        body, status = await HTTPController.post_session("p1", user="USER_SENTINEL")
        assert status == 201
        assert body["data"]["type"] == "sessions"
        assert body["data"]["id"] == "s-42"
        assert body["links"]["self"] == "/api/projects/p1/sessions/s-42"

    @patch("app.controllers.http_controller.create_session_uc")
    async def test_forwards_project_id_and_user(self, mock_uc):
        mock_uc.create_session = AsyncMock(return_value=Success({"id": "s1"}))
        await HTTPController.post_session("p1", user="USER_SENTINEL")
        mock_uc.create_session.assert_awaited_once_with("p1", user="USER_SENTINEL")

    @patch("app.controllers.http_controller.create_session_uc")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.create_session = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        _, status = await HTTPController.post_session("p1", user="U")
        assert status == 404


# ---------------------------------------------------------------------------
# list_sessions (L282-301) — JSON:API list with pagination
# ---------------------------------------------------------------------------


class TestListSessionsCharacterization:
    @patch("app.controllers.http_controller.list_sessions_uc")
    async def test_success_returns_200_with_list_envelope(self, mock_uc):
        mock_uc.list_sessions = AsyncMock(
            return_value=Success(
                {
                    "items": [{"id": "s1", "title": "A"}, {"id": "s2", "title": "B"}],
                    "next_cursor": "CUR",
                    "has_more": True,
                    "page_size": 30,
                }
            )
        )
        body, status = await HTTPController.list_sessions("p1", user="U")
        assert status == 200
        assert len(body["data"]) == 2
        assert body["data"][0]["type"] == "sessions"
        assert body["data"][0]["id"] == "s1"
        assert body["meta"]["page"] == {"size": 30, "has_more": True}
        assert "/api/projects/p1/sessions" in body["links"]["self"]

    @patch("app.controllers.http_controller.list_sessions_uc")
    async def test_forwards_cursor_page_size_user(self, mock_uc):
        mock_uc.list_sessions = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 30,
                }
            )
        )
        await HTTPController.list_sessions("p1", user="USER_SENTINEL", cursor="IN", page_size=10)
        mock_uc.list_sessions.assert_awaited_once_with("p1", user="USER_SENTINEL", cursor="IN", page_size=10)

    @patch("app.controllers.http_controller.list_sessions_uc")
    async def test_default_page_size_is_30(self, mock_uc):
        """Signature default: `page_size: int = 30` (L286). Pin this."""
        mock_uc.list_sessions = AsyncMock(
            return_value=Success(
                {
                    "items": [],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 30,
                }
            )
        )
        await HTTPController.list_sessions("p1", user="U")
        _args, kwargs = mock_uc.list_sessions.await_args
        assert kwargs["page_size"] == 30


# ---------------------------------------------------------------------------
# patch_session (L303-310) — kwargs become update_data dict
# ---------------------------------------------------------------------------


class TestPatchSessionCharacterization:
    @patch("app.controllers.http_controller.update_session_uc")
    async def test_success_returns_200_with_envelope(self, mock_uc):
        mock_uc.update_session = AsyncMock(return_value=Success({"id": "s1", "title": "Updated"}))
        body, status = await HTTPController.patch_session("p1", "s1", user="U", title="Updated")
        assert status == 200
        assert body["data"]["type"] == "sessions"
        assert body["data"]["id"] == "s1"
        assert body["links"]["self"] == "/api/projects/p1/sessions/s1"

    @patch("app.controllers.http_controller.update_session_uc")
    async def test_forwards_kwargs_as_update_data(self, mock_uc):
        mock_uc.update_session = AsyncMock(return_value=Success({"id": "s1"}))
        await HTTPController.patch_session("p1", "s1", user="USER_SENTINEL", title="New", pinned=True)
        mock_uc.update_session.assert_awaited_once_with(
            "s1", update_data={"title": "New", "pinned": True}, user="USER_SENTINEL"
        )

    @patch("app.controllers.http_controller.update_session_uc")
    async def test_session_not_found_returns_404(self, mock_uc):
        mock_uc.update_session = AsyncMock(return_value=Failure(SessionNotFound("s1")))
        _, status = await HTTPController.patch_session("p1", "s1", user="U", title="X")
        assert status == 404

    @patch("app.controllers.http_controller.update_session_uc")
    async def test_session_access_denied_returns_403(self, mock_uc):
        mock_uc.update_session = AsyncMock(return_value=Failure(SessionAccessDenied("s1")))
        _, status = await HTTPController.patch_session("p1", "s1", user="U", title="X")
        assert status == 403
