"""Tests for HTTPController.

Verifies that HTTPController returns correct tuple[dict, int] responses:
- Success returns JSON:API envelope ({data: {type, id, attributes}, links} or {data: [...], links, meta})
- Known errors return JSON:API errors ({errors: [{status, title, detail}]})
- Unknown errors return ({errors: [{status: "500", ...}]}, 500)
"""

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController, _error_response
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.exceptions import ProjectIdRequired, ProjectNotFound
from app.use_cases.upload.exceptions import (
    EmptyFile,
    InvalidFileType,
    UploadAlreadyProcessed,
    UploadNotFound,
)

# ---------------------------------------------------------------------------
# _error_response unit tests
# ---------------------------------------------------------------------------


class TestErrorResponse:
    def test_dataset_not_found(self):
        body, status = _error_response(DatasetNotFound("abc"))
        assert status == 404
        err = body["errors"][0]
        assert err["status"] == "404"
        assert err["title"] == "Dataset Not Found"
        assert err["detail"] == "Dataset with ID 'abc' not found"

    def test_project_not_found(self):
        body, status = _error_response(ProjectNotFound("xyz"))
        assert status == 404
        assert body["errors"][0]["status"] == "404"

    def test_fallback_to_500_for_unknown_exception(self):
        body, status = _error_response(RuntimeError("Something unexpected happened"))
        assert status == 500
        assert body["errors"][0]["status"] == "500"
        assert body["errors"][0]["title"] == "Internal Server Error"
        assert "unexpected error" in body["errors"][0]["detail"].lower()

    def test_upload_already_processed(self):
        body, status = _error_response(UploadAlreadyProcessed("upload-002"))
        assert status == 409
        assert body["errors"][0]["title"] == "Upload Already Processed"

    def test_invalid_file_type(self):
        _, status = _error_response(InvalidFileType())
        assert status == 400

    def test_empty_file(self):
        _, status = _error_response(EmptyFile())
        assert status == 400

    def test_project_id_required(self):
        _, status = _error_response(ProjectIdRequired())
        assert status == 400


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass
class FakeModel:
    id: str
    name: str

    def serialize(self):
        return {"id": self.id, "name": self.name}


# ---------------------------------------------------------------------------
# HTTPController method tests
# ---------------------------------------------------------------------------


class TestGetDataset:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Success(FakeModel("d1", "My Dataset")))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 200
        assert body["data"]["type"] == "datasets"
        assert body["data"]["id"] == "d1"
        assert body["data"]["attributes"]["name"] == "My Dataset"
        assert body["links"]["self"] == "/api/datasets/d1"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Failure(DatasetNotFound("d1")))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 404
        assert body["errors"][0]["status"] == "404"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_unknown_error_returns_500(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Failure(RuntimeError("Database exploded")))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 500
        assert body["errors"][0]["status"] == "500"


class TestListDatasets:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(
            return_value=Success(
                {
                    "items": [FakeModel("d1", "DS")],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 50,
                }
            )
        )
        body, status = await HTTPController.list_datasets("p1")
        assert status == 200
        assert len(body["data"]) == 1
        assert body["data"][0]["type"] == "datasets"
        assert body["data"][0]["id"] == "d1"
        assert body["meta"]["page"]["has_more"] is False

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_id_required_returns_400(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure(ProjectIdRequired()))
        _, status = await HTTPController.list_datasets(None)
        assert status == 400

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        _, status = await HTTPController.list_datasets("p1")
        assert status == 404


class TestPatchDataset:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_dataset = AsyncMock(return_value=Success(FakeModel("d1", "Updated")))
        body, status = await HTTPController.patch_dataset("d1", name="Updated")
        assert status == 200
        assert body["data"]["attributes"]["name"] == "Updated"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.update_dataset = AsyncMock(return_value=Failure(DatasetNotFound("d1")))
        _, status = await HTTPController.patch_dataset("d1", name="X")
        assert status == 404


class TestPostDataset:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Success(FakeModel("d1", "New Dataset")))
        _body, status = await HTTPController.post_dataset("u1")
        assert status == 201

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_upload_not_found_returns_404(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Failure(UploadNotFound("u1")))
        _, status = await HTTPController.post_dataset("u1")
        assert status == 404

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_already_processed_returns_409(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Failure(UploadAlreadyProcessed("u1")))
        _, status = await HTTPController.post_dataset("u1")
        assert status == 409


class TestPostUpload:
    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Success(FakeModel("u1", "upload")))
        _body, status = await HTTPController.post_upload(b"csv", "f.csv", "p1")
        assert status == 201

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_invalid_file_type_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure(InvalidFileType()))
        _, status = await HTTPController.post_upload(b"x", "f.xlsx", "p1")
        assert status == 400

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_empty_file_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure(EmptyFile()))
        _, status = await HTTPController.post_upload(b"", "f.csv", "p1")
        assert status == 400


class TestListProjectDatasets:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_datasets_for_project = AsyncMock(
            return_value=Success(
                {
                    "items": [{"id": "d1", "name": "DS"}],
                    "next_cursor": None,
                    "has_more": False,
                    "page_size": 50,
                }
            )
        )
        body, status = await HTTPController.list_project_datasets("p1")
        assert status == 200
        assert len(body["data"]) == 1
        assert body["data"][0]["type"] == "datasets"
        assert body["data"][0]["id"] == "d1"
        assert body["meta"]["page"]["has_more"] is False

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.list_datasets_for_project = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        _, status = await HTTPController.list_project_datasets("p1")
        assert status == 404
