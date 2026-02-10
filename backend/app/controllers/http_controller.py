"""HTTP controller for serializing domain models to JSON responses."""

from typing import Any

from returns.result import Success, Failure

from .response_wrapper import wrap_success
from app.use_cases import dataset as dataset_use_cases
from app.use_cases import upload as upload_use_cases
from app.use_cases import project as project_use_cases
from app.use_cases.exceptions import (
    DomainException,
    DatasetNotFound,
    EmptyFile,
    InvalidFileType,
    ProjectIdRequired,
    ProjectNotFound,
    UploadAlreadyProcessed,
    UploadNotFound,
)


def _serialize(data: Any) -> Any:
    """Serialize use case result data for HTTP response.

    Handles single models and iterables by calling model.serialize().
    """
    match data:
        case _ if hasattr(data, 'serialize'):
            return data.serialize()
        case list() | tuple():
            return [_serialize(item) for item in data]
        case _:
            return data


def _error_response(error: str, *matchers: DomainException) -> tuple[dict, int]:
    """Match an error string against domain exceptions and return RFC 9457 response."""
    for m in matchers:
        if m.is_match(error):
            return {"type": m._type, "title": m._title, "status": m._status_code, "detail": m._message}, m._status_code
    return {"type": "INTERNAL_ERROR", "title": "Internal Server Error", "status": 500, "detail": error}, 500


class HTTPController:
    """Controller that serializes domain models for HTTP responses.

    Returns tuple[dict, int] — body and status code.
    """

    @staticmethod
    async def list_datasets(project_id: str) -> tuple[dict, int]:
        result = await dataset_use_cases.list_datasets(project_id)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error, ProjectIdRequired(), ProjectNotFound(project_id))

    @staticmethod
    async def get_dataset(dataset_id: str, include_transforms: bool = True,
                          include_preview: bool = False, preview_limit: int = 10) -> tuple[dict, int]:
        result = await dataset_use_cases.get_dataset(
            dataset_id, include_transforms, include_preview, preview_limit
        )
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error, DatasetNotFound(dataset_id))

    @staticmethod
    async def patch_dataset(dataset_id: str, **kwargs) -> tuple[dict, int]:
        result = await dataset_use_cases.update_dataset(dataset_id, kwargs)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error, DatasetNotFound(dataset_id))

    @staticmethod
    async def post_dataset(upload_id: str, partition_fields: list[str] | None = None,
                           description: str | None = None) -> tuple[dict, int]:
        result = await dataset_use_cases.create_dataset_from_upload(
            upload_id=upload_id, partition_fields=partition_fields,
            description=description
        )
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 201
            case Failure(error):
                return _error_response(error, UploadNotFound(upload_id), ProjectNotFound(), UploadAlreadyProcessed(upload_id))

    @staticmethod
    async def post_upload(file_content: bytes, file_name: str, project_id: str,
                          dataset_id: str | None = None) -> tuple[dict, int]:
        result = await upload_use_cases.upload_file(
            file_content=file_content, file_name=file_name,
            project_id=project_id, dataset_id=dataset_id
        )
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 201
            case Failure(error):
                return _error_response(error, InvalidFileType(), EmptyFile(), ProjectNotFound(project_id), DatasetNotFound(dataset_id))

    # Project methods

    @staticmethod
    async def list_projects() -> tuple[dict, int]:
        result = await project_use_cases.list_projects()
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def get_project(project_id: str, include_datasets: bool = True) -> tuple[dict, int]:
        result = await project_use_cases.get_project(project_id, include_datasets=include_datasets)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error, ProjectNotFound(project_id))

    @staticmethod
    async def post_project(name: str, description: str | None = None) -> tuple[dict, int]:
        result = await project_use_cases.create_project(name=name, description=description)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 201
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def patch_project(project_id: str, **kwargs) -> tuple[dict, int]:
        result = await project_use_cases.update_project(project_id, kwargs)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error, ProjectNotFound(project_id))

    @staticmethod
    async def delete_project(project_id: str) -> tuple[dict, int]:
        result = await project_use_cases.delete_project(project_id)
        match result:
            case Success(data):
                return wrap_success({"deleted": data}), 200
            case Failure(error):
                return _error_response(error, ProjectNotFound(project_id))
