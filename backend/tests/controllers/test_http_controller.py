"""Tests for HTTPController.

Verifies that HTTPController returns correct tuple[dict, int] responses:
- Success returns ({"success": True, "data": ...}, status_code)
- Known errors return ({"type": ..., "title": ..., "status": N, "detail": ...}, N)
- Unknown errors return ({"type": "INTERNAL_ERROR", ...}, 500)
"""

from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

import pytest
from returns.result import Success, Failure

from app.controllers.http_controller import HTTPController, _error_response


# ---------------------------------------------------------------------------
# _error_response unit tests
# ---------------------------------------------------------------------------

class TestErrorResponse:

    def test_matches_first_matcher(self):
        from app.use_cases.exceptions import DatasetNotFound
        body, status = _error_response(
            "[get_dataset] Dataset with ID 'abc' not found",
            DatasetNotFound("abc"),
        )
        assert status == 404
        assert body["type"] == "DATASET_NOT_FOUND"
        assert body["title"] == "Dataset Not Found"
        assert body["status"] == 404
        assert body["detail"] == "Dataset with ID 'abc' not found"

    def test_falls_through_to_second_matcher(self):
        from app.use_cases.exceptions import UploadNotFound, ProjectNotFound
        body, status = _error_response(
            "[create_dataset_from_upload] Project with ID 'xyz' not found",
            UploadNotFound("upload-1"),
            ProjectNotFound(),
        )
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"

    def test_fallback_to_500_when_no_match(self):
        body, status = _error_response("Something unexpected happened")
        assert status == 500
        assert body["type"] == "INTERNAL_ERROR"
        assert body["title"] == "Internal Server Error"
        assert body["detail"] == "Something unexpected happened"

    def test_upload_already_processed_matches(self):
        from app.use_cases.exceptions import UploadAlreadyProcessed
        body, status = _error_response(
            "[create_dataset_from_upload] [OutboxRepository] Event upload-002 has already been processed",
            UploadAlreadyProcessed("upload-002"),
        )
        assert status == 409
        assert body["type"] == "UPLOAD_ALREADY_PROCESSED"

    def test_invalid_file_type_matches(self):
        from app.use_cases.exceptions import InvalidFileType
        body, status = _error_response(
            "[upload_file] Only CSV files are supported",
            InvalidFileType(),
        )
        assert status == 400
        assert body["type"] == "INVALID_FILE_TYPE"

    def test_empty_file_matches(self):
        from app.use_cases.exceptions import EmptyFile
        body, status = _error_response(
            "[upload_file] File is empty",
            EmptyFile(),
        )
        assert status == 400
        assert body["type"] == "EMPTY_FILE"

    def test_project_id_required_matches(self):
        from app.use_cases.exceptions import ProjectIdRequired
        body, status = _error_response(
            "[list_datasets] project_id is required",
            ProjectIdRequired(),
        )
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
        mock_uc.get_dataset = AsyncMock(return_value=Failure("[get_dataset] Dataset with ID 'd1' not found"))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 404
        assert body["type"] == "DATASET_NOT_FOUND"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_unknown_error_returns_500(self, mock_uc):
        mock_uc.get_dataset = AsyncMock(return_value=Failure("Database exploded"))
        body, status = await HTTPController.get_dataset("d1")
        assert status == 500
        assert body["type"] == "INTERNAL_ERROR"


class TestListDatasets:

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Success([FakeModel("d1", "DS")]))
        body, status = await HTTPController.list_datasets("p1")
        assert status == 200
        assert body == {"success": True, "data": [{"id": "d1", "name": "DS"}]}

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_id_required_returns_400(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure("[list_datasets] project_id is required"))
        body, status = await HTTPController.list_datasets(None)
        assert status == 400
        assert body["type"] == "PROJECT_ID_REQUIRED"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_project_not_found_returns_404(self, mock_uc):
        mock_uc.list_datasets = AsyncMock(return_value=Failure("[list_datasets] Project with ID 'p1' not found"))
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
        mock_uc.update_dataset = AsyncMock(return_value=Failure("[update_dataset] Dataset with ID 'd1' not found"))
        body, status = await HTTPController.patch_dataset("d1", name="X")
        assert status == 404
        assert body["type"] == "DATASET_NOT_FOUND"


class TestPostDataset:

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(return_value=Success(FakeModel("d1", "New Dataset")))
        body, status = await HTTPController.post_dataset("u1")
        assert status == 201

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_upload_not_found_returns_404(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(
            return_value=Failure("[create_dataset_from_upload] Upload with ID 'u1' not found")
        )
        body, status = await HTTPController.post_dataset("u1")
        assert status == 404
        assert body["type"] == "UPLOAD_NOT_FOUND"

    @patch("app.controllers.http_controller.dataset_use_cases")
    async def test_already_processed_returns_409(self, mock_uc):
        mock_uc.create_dataset_from_upload = AsyncMock(
            return_value=Failure("[create_dataset_from_upload] [OutboxRepository] Event u1 has already been processed")
        )
        body, status = await HTTPController.post_dataset("u1")
        assert status == 409
        assert body["type"] == "UPLOAD_ALREADY_PROCESSED"


class TestPostUpload:

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Success(FakeModel("u1", "upload")))
        body, status = await HTTPController.post_upload(b"csv", "f.csv", "p1")
        assert status == 201

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_invalid_file_type_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure("[upload_file] Only CSV files are supported"))
        body, status = await HTTPController.post_upload(b"x", "f.xlsx", "p1")
        assert status == 400
        assert body["type"] == "INVALID_FILE_TYPE"

    @patch("app.controllers.http_controller.upload_use_cases")
    async def test_empty_file_returns_400(self, mock_uc):
        mock_uc.upload_file = AsyncMock(return_value=Failure("[upload_file] File is empty"))
        body, status = await HTTPController.post_upload(b"", "f.csv", "p1")
        assert status == 400
        assert body["type"] == "EMPTY_FILE"


class TestListProjects:

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.list_projects = AsyncMock(return_value=Success([FakeModel("p1", "Proj")]))
        body, status = await HTTPController.list_projects()
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_failure_returns_500(self, mock_uc):
        mock_uc.list_projects = AsyncMock(return_value=Failure("DB error"))
        body, status = await HTTPController.list_projects()
        assert status == 500
        assert body["type"] == "INTERNAL_ERROR"


class TestGetProject:

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.get_project = AsyncMock(return_value=Success(FakeModel("p1", "Proj")))
        body, status = await HTTPController.get_project("p1")
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.get_project = AsyncMock(return_value=Failure("[get_project] Project with ID 'p1' not found"))
        body, status = await HTTPController.get_project("p1")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"


class TestPostProject:

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_201(self, mock_uc):
        mock_uc.create_project = AsyncMock(return_value=Success(FakeModel("p1", "New")))
        body, status = await HTTPController.post_project("New")
        assert status == 201


class TestPatchProject:

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_success_returns_200(self, mock_uc):
        mock_uc.update_project = AsyncMock(return_value=Success(FakeModel("p1", "Updated")))
        body, status = await HTTPController.patch_project("p1", name="Updated")
        assert status == 200

    @patch("app.controllers.http_controller.project_use_cases")
    async def test_not_found_returns_404(self, mock_uc):
        mock_uc.update_project = AsyncMock(return_value=Failure("[update_project] Project with ID 'p1' not found"))
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
        mock_uc.delete_project = AsyncMock(return_value=Failure("[delete_project] Project with ID 'p1' not found"))
        body, status = await HTTPController.delete_project("p1")
        assert status == 404
        assert body["type"] == "PROJECT_NOT_FOUND"
