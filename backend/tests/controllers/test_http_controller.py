"""Tests for the shared ``_error_response`` mapper re-exported by http_controller.

The per-context controllers own their own endpoint tests (see
``test_dataset_controller.py``, ``test_project_controller.py``, ...). What remains
here is the domain-exception → JSON:API status/title/detail mapping, which every
controller funnels through and which tests import from this module by name.
"""

from app.controllers.http_controller import _error_response
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.exceptions import ProjectIdRequired, ProjectNotFound
from app.use_cases.upload.exceptions import (
    EmptyFile,
    InvalidFileType,
    UploadAlreadyProcessed,
)


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
