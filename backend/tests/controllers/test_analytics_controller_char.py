"""Characterization tests — Seam 5: Analytics Authoring controller (Views + Reports).

Pins the CURRENT observable behavior of the view/report endpoints on
HTTPController (L349-450). These tests must remain green after extraction to
`view_controller.py` and `report_controller.py`.

No existing coverage in test_http_controller.py — everything here is new.

Special note (seams.md Risks #3): `get_view` (L378) inlines
`ViewSQLGenerator().generate_display(data)` and attaches its result as
`display_sql` on the serialized payload. This is a controller-layer leak of
view-rendering logic. The behavior is pinned below; do NOT fix as part of the
extraction — lift-and-shift keeps this leak visible so the follow-up bead can
push it down into the use case.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.report.exceptions import InvalidReportReference, ReportNotFound
from app.use_cases.view.exceptions import (
    CircularDependency,
    InvalidSourceReference,
    ViewNotFound,
)


@dataclass
class _Model:
    id: str
    name: str = "x"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class TestListViewsCharacterization:
    """L349-357: list uses `len(items)` as page_size, next_cursor=None, has_more=False.
    That's a non-paginating list — whole result in one response."""

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_success_returns_non_paginated_list(self, mock_uc):
        mock_uc.list_views = AsyncMock(
            return_value=Success([_Model("v1", "A"), _Model("v2", "B")])
        )
        body, status = await HTTPController.list_views("p1")
        assert status == 200
        assert len(body["data"]) == 2
        assert body["data"][0]["type"] == "views"
        assert body["meta"]["page"] == {"size": 2, "has_more": False}
        assert "/api/projects/p1/views" in body["links"]["self"]

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_forwards_project_id_and_project(self, mock_uc):
        mock_uc.list_views = AsyncMock(return_value=Success([]))
        proj = {"id": "p1"}
        await HTTPController.list_views("p1", project=proj)
        mock_uc.list_views.assert_awaited_once_with("p1", project=proj)

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_empty_list_returns_empty_data(self, mock_uc):
        mock_uc.list_views = AsyncMock(return_value=Success([]))
        body, status = await HTTPController.list_views("p1")
        assert status == 200
        assert body["data"] == []
        assert body["meta"]["page"]["size"] == 0


class TestPostViewCharacterization:
    @patch("app.controllers.http_controller.view_use_cases")
    async def test_success_returns_201_with_nested_self_link(self, mock_uc):
        mock_uc.create_view = AsyncMock(
            return_value=Success(_Model("V-NEW", "New View"))
        )
        body, status = await HTTPController.post_view(
            "p1", name="New View", definition={"sources": []}
        )
        assert status == 201
        assert body["data"]["type"] == "views"
        assert body["data"]["id"] == "V-NEW"
        assert body["links"]["self"] == "/api/projects/p1/views/V-NEW"

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_forwards_kwargs(self, mock_uc):
        mock_uc.create_view = AsyncMock(return_value=Success(_Model("v1")))
        proj = {"id": "p1"}
        await HTTPController.post_view(
            "p1", project=proj, name="N", definition={"x": 1}
        )
        mock_uc.create_view.assert_awaited_once_with(
            project_id="p1", project=proj, name="N", definition={"x": 1}
        )

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_invalid_source_reference_returns_400(self, mock_uc):
        mock_uc.create_view = AsyncMock(
            return_value=Failure(InvalidSourceReference(["missing-id"]))
        )
        _, status = await HTTPController.post_view("p1", name="X")
        assert status == 400

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_circular_dependency_returns_400(self, mock_uc):
        mock_uc.create_view = AsyncMock(
            return_value=Failure(CircularDependency("v1"))
        )
        _, status = await HTTPController.post_view("p1", name="X")
        assert status == 400


class TestGetViewCharacterization:
    """L370-381: pins the display_sql leak (Risks #3)."""

    @patch("app.controllers.http_controller.view_use_cases")
    @patch("app.use_cases.view.sql_generator.ViewSQLGenerator")
    async def test_success_attaches_display_sql_from_generator(
        self, mock_generator_cls, mock_uc
    ):
        """L378 inlines `ViewSQLGenerator().generate_display(data)` on the
        serialized payload. Pin this verbatim.
        KNOWN LEAK: seams.md Risks #3 — view-rendering logic in the controller,
        locked in by characterization, fix scheduled for a follow-up bead."""
        mock_generator = MagicMock()
        mock_generator.generate_display.return_value = "SELECT 1;"
        mock_generator_cls.return_value = mock_generator

        view_obj = _Model("v1", "My View")
        mock_uc.get_view = AsyncMock(return_value=Success(view_obj))
        body, status = await HTTPController.get_view("v1")

        assert status == 200
        assert body["data"]["type"] == "views"
        assert body["data"]["id"] == "v1"
        # The leak: display_sql attached in the controller, not the use case
        assert body["data"]["attributes"]["display_sql"] == "SELECT 1;"
        # Generator was called with the raw use-case data (the model itself)
        mock_generator.generate_display.assert_called_once_with(view_obj)

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_view = AsyncMock(return_value=Failure(ViewNotFound("v1")))
        _, status = await HTTPController.get_view("v1")
        assert status == 404

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_forwards_project(self, mock_uc):
        mock_uc.get_view = AsyncMock(return_value=Failure(ViewNotFound("v1")))
        proj = {"id": "p1"}
        await HTTPController.get_view("v1", project=proj)
        mock_uc.get_view.assert_awaited_once_with("v1", project=proj)


class TestPatchViewCharacterization:
    @patch("app.controllers.http_controller.view_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_view = AsyncMock(return_value=Success(_Model("v1", "Updated")))
        body, status = await HTTPController.patch_view("v1", name="Updated")
        assert status == 200
        assert body["data"]["attributes"]["name"] == "Updated"
        assert body["links"]["self"] == "/api/views/v1"

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_forwards_kwargs_as_update_dict(self, mock_uc):
        mock_uc.update_view = AsyncMock(return_value=Success(_Model("v1")))
        proj = {"id": "p1"}
        await HTTPController.patch_view(
            "v1", project=proj, name="N", definition={"x": 1}
        )
        mock_uc.update_view.assert_awaited_once_with(
            "v1", {"name": "N", "definition": {"x": 1}}, project=proj
        )


class TestDeleteViewCharacterization:
    @patch("app.controllers.http_controller.view_use_cases")
    async def test_success_returns_200_with_meta_deleted(self, mock_uc):
        mock_uc.delete_view = AsyncMock(return_value=Success(True))
        body, status = await HTTPController.delete_view("v1")
        assert status == 200
        assert body == {"meta": {"deleted": True}}

    @patch("app.controllers.http_controller.view_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.delete_view = AsyncMock(return_value=Failure(ViewNotFound("v1")))
        _, status = await HTTPController.delete_view("v1")
        assert status == 404


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class TestListReportsCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_non_paginated_list(self, mock_uc):
        mock_uc.list_reports = AsyncMock(
            return_value=Success([_Model("r1", "A"), _Model("r2", "B")])
        )
        body, status = await HTTPController.list_reports("p1")
        assert status == 200
        assert len(body["data"]) == 2
        assert body["data"][0]["type"] == "reports"
        assert body["meta"]["page"] == {"size": 2, "has_more": False}
        assert "/api/projects/p1/reports" in body["links"]["self"]

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_forwards_project_id_and_project(self, mock_uc):
        mock_uc.list_reports = AsyncMock(return_value=Success([]))
        proj = {"id": "p1"}
        await HTTPController.list_reports("p1", project=proj)
        mock_uc.list_reports.assert_awaited_once_with("p1", project=proj)


class TestPostReportCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_201_with_nested_self_link(self, mock_uc):
        mock_uc.create_report = AsyncMock(
            return_value=Success(_Model("R-NEW", "New Report"))
        )
        body, status = await HTTPController.post_report(
            "p1", name="New Report", definition={}
        )
        assert status == 201
        assert body["data"]["type"] == "reports"
        assert body["data"]["id"] == "R-NEW"
        assert body["links"]["self"] == "/api/projects/p1/reports/R-NEW"

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_forwards_kwargs(self, mock_uc):
        mock_uc.create_report = AsyncMock(return_value=Success(_Model("r1")))
        proj = {"id": "p1"}
        await HTTPController.post_report(
            "p1", project=proj, name="N", definition={"x": 1}
        )
        mock_uc.create_report.assert_awaited_once_with(
            project_id="p1", project=proj, name="N", definition={"x": 1}
        )

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_invalid_report_reference_returns_400(self, mock_uc):
        mock_uc.create_report = AsyncMock(
            return_value=Failure(InvalidReportReference())
        )
        _, status = await HTTPController.post_report("p1", name="X")
        assert status == 400


class TestGetReportCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.get_report = AsyncMock(return_value=Success(_Model("r1", "My Report")))
        body, status = await HTTPController.get_report("r1")
        assert status == 200
        assert body["data"]["type"] == "reports"
        assert body["data"]["id"] == "r1"
        assert body["links"]["self"] == "/api/reports/r1"

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_report = AsyncMock(return_value=Failure(ReportNotFound("r1")))
        _, status = await HTTPController.get_report("r1")
        assert status == 404


class TestPatchReportCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_report = AsyncMock(
            return_value=Success(_Model("r1", "Updated"))
        )
        body, status = await HTTPController.patch_report("r1", name="Updated")
        assert status == 200
        assert body["data"]["attributes"]["name"] == "Updated"

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_forwards_kwargs_as_update_dict(self, mock_uc):
        mock_uc.update_report = AsyncMock(return_value=Success(_Model("r1")))
        proj = {"id": "p1"}
        await HTTPController.patch_report(
            "r1", project=proj, name="N", definition={"x": 1}
        )
        mock_uc.update_report.assert_awaited_once_with(
            "r1", {"name": "N", "definition": {"x": 1}}, project=proj
        )


class TestDeleteReportCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_200_with_meta_deleted(self, mock_uc):
        mock_uc.delete_report = AsyncMock(return_value=Success(True))
        body, status = await HTTPController.delete_report("r1")
        assert status == 200
        assert body == {"meta": {"deleted": True}}

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.delete_report = AsyncMock(return_value=Failure(ReportNotFound("r1")))
        _, status = await HTTPController.delete_report("r1")
        assert status == 404
