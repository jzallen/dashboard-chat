"""HTTP controller for serializing domain models to JSON responses."""

import logging
from typing import Any

from returns.result import Success, Failure

from .response_wrapper import wrap_success
from app.use_cases import dataset as dataset_use_cases
from app.use_cases import upload as upload_use_cases
from app.use_cases import project as project_use_cases
from app.use_cases import transform as transform_use_cases
from app.use_cases import organization as organization_use_cases
from app.use_cases.exceptions import DomainException

logger = logging.getLogger(__name__)


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


def _error_response(error: Exception) -> tuple[dict, int]:
    """Build an RFC 9457 error response from an exception.

    DomainException subclasses carry status_code, type, and title.
    All other exceptions map to a generic 500.
    """
    if isinstance(error, DomainException):
        return {
            "type": error._type,
            "title": error._title,
            "status": error._status_code,
            "detail": str(error),
        }, error._status_code

    logger.error("Unhandled error: %s", error)
    return {"type": "INTERNAL_SERVER_ERROR", "title": "Internal Server Error", "status": 500, "detail": "An unexpected error occurred. Check server logs for details."}, 500


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
                return _error_response(error)

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
                return _error_response(error)

    @staticmethod
    async def patch_dataset(dataset_id: str, **kwargs) -> tuple[dict, int]:
        result = await dataset_use_cases.update_dataset(dataset_id, kwargs)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 200
            case Failure(error):
                return _error_response(error)

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
                return _error_response(error)

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
                return _error_response(error)

    # Transform methods

    @staticmethod
    async def post_transforms(dataset_id: str, transforms: list[dict]) -> tuple[dict, int]:
        result = await transform_use_cases.create_transforms(dataset_id, transforms)
        match result:
            case Success():
                return {"ok": True}, 201
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def patch_transforms(dataset_id: str, updates: list[dict]) -> tuple[dict, int]:
        result = await transform_use_cases.update_transforms(dataset_id, updates)
        match result:
            case Success():
                return {"ok": True}, 200
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def preview_transform(
        dataset_id: str, target_column: str, expression_config: dict
    ) -> tuple[dict, int]:
        result = await transform_use_cases.preview_cleaning_transform(
            dataset_id, target_column, expression_config
        )
        match result:
            case Success(data):
                return wrap_success(data), 200
            case Failure(error):
                return _error_response(error)

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
                return _error_response(error)

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
                return _error_response(error)

    @staticmethod
    async def delete_project(project_id: str) -> tuple[dict, int]:
        result = await project_use_cases.delete_project(project_id)
        match result:
            case Success(data):
                return wrap_success({"deleted": data}), 200
            case Failure(error):
                return _error_response(error)

    # Organization methods

    @staticmethod
    async def post_organization(name: str) -> tuple[dict, int]:
        result = await organization_use_cases.create_organization(name=name)
        match result:
            case Success(data):
                return wrap_success(_serialize(data)), 201
            case Failure(error):
                return _error_response(error)

    @staticmethod
    async def get_my_organization() -> tuple[dict, int]:
        result = await organization_use_cases.get_organization()
        match result:
            case Success(data):
                return wrap_success(data), 200
            case Failure(error):
                return _error_response(error)
