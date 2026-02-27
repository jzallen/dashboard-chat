"""Tests for HTTPController.

Verifies that HTTPController returns correct tuple[dict, int] responses:
- Success returns ({"success": True, "data": ...}, status_code)
- Known errors return ({"type": ..., "title": ..., "status": N, "detail": ...}, N)
- Unknown errors return ({"type": "INTERNAL_ERROR", ...}, 500)
"""

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

from returns.result import Failure, Success

from app.controllers.http_controller import HTTPController, _error_response
from app.use_cases.exceptions import (
    DatasetNotFound,
    EmptyFile,
    InvalidFileType,
    ProjectIdRequired,
    ProjectNotFound,
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
        assert body["type"] == "DATASET_NOT_FOUND"
        assert body["title"] == "Dataset Not Found"
        assert body["status"] == 404
        assert body["detail"] == "Dataset with ID 'abc' not found"

    def test_project_not_found(self):
        body, status = _error_response(ProjectNotFound("xyz"))
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"

    def test_fallback_to_500_for_unknown_exception(self):
        body, status = _error_response(RuntimeError("Something unexpected happened"))
        assert status == 500
        assert body["type"] == "INTERNAL_SERVER_ERROR"
        assert body["title"] == "Internal Server Error"
        assert "unexpected error" in body["detail"].lower()

    def test_upload_already_processed(self):
        body, status = _error_response(UploadAlreadyProcessed("upload-002"))
        assert status == 409
        assert body["type"] == "UPLOAD_ALREADY_PROCESSED"

    def test_invalid_file_type(self):
        body, status = _error_response(InvalidFileType())
        assert status == 400
        assert body["type"] == "INVALID_FILE_TYPE"

    def test_empty_file(self):
        body, status = _error_response(EmptyFile())
        assert status == 400
        assert body["type"] == "EMPTY_FILE"

    def test_project_id_required(self):
        body, status = _error_response(ProjectIdRequired())
        assert status == 400
        assert body["type"] == "PROJECT_ID_REQUIRED"


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
        assert body == {"success": True, "data": {"id": "d1", "name": "My Dataset"}}

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Failure(DatasetNotFound("d1")))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 404
        assert body["type"] == "DATASET_NOT_FOUND"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_unknown_error_returns_500(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Failure(RuntimeError("Database exploded")))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 500
        assert body["type"] == "INTERNAL_SERVER_ERROR"


class TestListDatasets:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Success([FakeModel("d1", "DS")]))
        body, status = await HTTPController.list_datasets("p1")
        assert status == 200
        assert body == {"success": True, "data": [{"id": "d1", "name": "DS"}]}

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_id_required_returns_400(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure(ProjectIdRequired()))
        body, status = await HTTPController.list_datasets(None)
        assert status == 400
        assert body["type"] == "PROJECT_ID_REQUIRED"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        body, status = await HTTPController.list_datasets("p1")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"


class TestPatchDataset:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_dataset = AsyncMock(return_value=Success(FakeModel("d1", "Updated")))
        body, status = await HTTPController.patch_dataset("d1", name="Updated")
        assert status == 200
        assert body["data"]["name"] == "Updated"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.update_dataset = AsyncMock(return_value=Failure(DatasetNotFound("d1")))
        body, status = await HTTPController.patch_dataset("d1", name="X")
        assert status == 404
        assert body["type"] == "DATASET_NOT_FOUND"


class TestPostDataset:
    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Success(FakeModel("d1", "New Dataset")))
        _body, status = await HTTPController.post_dataset("u1")
        assert status == 201

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_upload_not_found_returns_404(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Failure(UploadNotFound("u1")))
        body, status = await HTTPController.post_dataset("u1")
        assert status == 404
        assert body["type"] == "UPLOAD_NOT_FOUND"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_already_processed_returns_409(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Failure(UploadAlreadyProcessed("u1")))
        body, status = await HTTPController.post_dataset("u1")
        assert status == 409
        assert body["type"] == "UPLOAD_ALREADY_PROCESSED"


class TestPostUpload:
    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Success(FakeModel("u1", "upload")))
        _body, status = await HTTPController.post_upload(b"csv", "f.csv", "p1")
        assert status == 201

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_invalid_file_type_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure(InvalidFileType()))
        body, status = await HTTPController.post_upload(b"x", "f.xlsx", "p1")
        assert status == 400
        assert body["type"] == "INVALID_FILE_TYPE"

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_empty_file_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure(EmptyFile()))
        body, status = await HTTPController.post_upload(b"", "f.csv", "p1")
        assert status == 400
        assert body["type"] == "EMPTY_FILE"


class TestListProjects:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_projects = AsyncMock(return_value=Success([FakeModel("p1", "Proj")]))
        _body, status = await HTTPController.list_projects()
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_failure_returns_500(self, mock_uc):
        mock_uc.list_projects = AsyncMock(return_value=Failure(RuntimeError("DB error")))
        body, status = await HTTPController.list_projects()
        assert status == 500
        assert body["type"] == "INTERNAL_SERVER_ERROR"


class TestGetProject:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.get_project = AsyncMock(return_value=Success(FakeModel("p1", "Proj")))
        _body, status = await HTTPController.get_project("p1")
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_project = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        body, status = await HTTPController.get_project("p1")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"


class TestPostProject:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.create_project = AsyncMock(return_value=Success(FakeModel("p1", "New")))
        _body, status = await HTTPController.post_project("New")
        assert status == 201


class TestPatchProject:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_project = AsyncMock(return_value=Success(FakeModel("p1", "Updated")))
        _body, status = await HTTPController.patch_project("p1", name="Updated")
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.update_project = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        body, status = await HTTPController.patch_project("p1", name="X")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"


class TestDeleteProject:
    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200_with_deleted(self, mock_uc):
        mock_uc.delete_project = AsyncMock(return_value=Success(True))
        body, status = await HTTPController.delete_project("p1")
        assert status == 200
        assert body == {"success": True, "data": {"deleted": True}}

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.delete_project = AsyncMock(return_value=Failure(ProjectNotFound("p1")))
        body, status = await HTTPController.delete_project("p1")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"
