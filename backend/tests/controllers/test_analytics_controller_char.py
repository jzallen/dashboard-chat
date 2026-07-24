"""Characterization tests for the Report endpoints on HTTPController.

Pins the CURRENT observable behavior of the report endpoints while Reports are
still routed through the http_controller roll-up. The View half of the Analytics
Authoring context has moved to `ViewController` with injected use cases — see
`test_view_controller.py`.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController
from app.use_cases.report.exceptions import InvalidReportReference, ReportNotFound


@dataclass
class _Model:
    id: str
    name: str = "x"

    def serialize(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class TestListReportsCharacterization:
    @patch("app.controllers.http_controller.report_use_cases")
    async def test_success_returns_non_paginated_list(self, mock_uc):
        mock_uc.list_reports = AsyncMock(return_value=Success([_Model("r1", "A"), _Model("r2", "B")]))
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
        mock_uc.create_report = AsyncMock(return_value=Success(_Model("R-NEW", "New Report")))
        body, status = await HTTPController.post_report("p1", name="New Report", definition={})
        assert status == 201
        assert body["data"]["type"] == "reports"
        assert body["data"]["id"] == "R-NEW"
        assert body["links"]["self"] == "/api/projects/p1/reports/R-NEW"

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_forwards_kwargs(self, mock_uc):
        mock_uc.create_report = AsyncMock(return_value=Success(_Model("r1")))
        proj = {"id": "p1"}
        await HTTPController.post_report("p1", project=proj, name="N", definition={"x": 1})
        mock_uc.create_report.assert_awaited_once_with(project_id="p1", project=proj, name="N", definition={"x": 1})

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_invalid_report_reference_returns_400(self, mock_uc):
        mock_uc.create_report = AsyncMock(return_value=Failure(InvalidReportReference()))
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
        mock_uc.update_report = AsyncMock(return_value=Success(_Model("r1", "Updated")))
        body, status = await HTTPController.patch_report("r1", name="Updated")
        assert status == 200
        assert body["data"]["attributes"]["name"] == "Updated"

    @patch("app.controllers.http_controller.report_use_cases")
    async def test_forwards_kwargs_as_update_dict(self, mock_uc):
        mock_uc.update_report = AsyncMock(return_value=Success(_Model("r1")))
        proj = {"id": "p1"}
        await HTTPController.patch_report("r1", project=proj, name="N", definition={"x": 1})
        mock_uc.update_report.assert_awaited_once_with("r1", {"name": "N", "definition": {"x": 1}}, project=proj)


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
