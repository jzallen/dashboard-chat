"""Dataset Ingestion HTTP controller — Seam 1 of dc-e65d (largest).

Thin HTTP adapter for the Dataset Ingestion bounded context — the Upload→
Dataset→Transform pipeline plus dataset search within a project.
Delegates to `app/use_cases/dataset` and `app/use_cases/upload`.

Use-case aliases read off `http_controller` at call time:
  - dataset_use_cases (package alias)
  - upload_use_cases (package alias)
  - search_datasets_uc (submodule alias)

Keeps test patches on those names working after extraction.
"""

from returns.result import Failure, Success

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


def _dataset_uc():
    from app.controllers import http_controller

    return http_controller.dataset_use_cases


def _upload_uc():
    from app.controllers import http_controller

    return http_controller.upload_use_cases


def _search_uc():
    from app.controllers import http_controller

    return http_controller.search_datasets_uc


class DatasetController:
    """Controller for Dataset + Upload + Transform + Search HTTP endpoints."""

    # --------------------------------------------------------------
    # Dataset CRUD
    # --------------------------------------------------------------

    @staticmethod
    async def list_datasets(
        project_id: str,
        cursor: str | None = None,
        page_size: int = 50,
        base_url: str = "/api/datasets",
        archived: bool | None = None,
    ) -> tuple[dict, int]:
        result = await _dataset_uc().list_datasets(project_id, cursor=cursor, page_size=page_size, archived=archived)
        match result:
            case Success(data):
                items = [serialize(i) for i in data["items"]]
                resp = wrap_jsonapi_list(
                    "datasets", items, base_url, data["page_size"], data["next_cursor"], data["has_more"]
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_project_datasets(
        project_id: str,
        cursor: str | None = None,
        page_size: int = 50,
        base_url: str = "/api/projects",
        archived: bool | None = None,
    ) -> tuple[dict, int]:
        result = await _dataset_uc().list_datasets_for_project(
            project_id, cursor=cursor, page_size=page_size, archived=archived
        )
        match result:
            case Success(data):
                items = data["items"]
                url = f"{base_url}/{project_id}/datasets"
                resp = wrap_jsonapi_list(
                    "datasets", items, url, data["page_size"], data["next_cursor"], data["has_more"]
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def get_dataset(
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> tuple[dict, int]:
        result = await _dataset_uc().get_dataset(dataset_id, include_transforms, include_preview, preview_limit)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_dataset(dataset_id: str, **kwargs) -> tuple[dict, int]:
        result = await _dataset_uc().update_dataset(dataset_id, kwargs)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def archive_dataset(dataset_id: str) -> tuple[dict, int]:
        """Move a dataset to cold storage (MR-7)."""
        result = await _dataset_uc().archive_dataset(dataset_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def restore_dataset(dataset_id: str) -> tuple[dict, int]:
        """Bring a dataset back from cold storage (MR-7)."""
        result = await _dataset_uc().restore_dataset(dataset_id)
        match result:
            case Success(data):
                return wrap_jsonapi_single("datasets", serialize(data), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_dataset(
        upload_id: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
        plugin_registry=None,
        choices: dict[str, str] | None = None,
    ) -> tuple[dict, int]:
        result = await _dataset_uc().create_dataset_from_upload(
            upload_id=upload_id,
            partition_fields=partition_fields,
            description=description,
            plugin_registry=plugin_registry,
            choices=choices,
        )
        match result:
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("datasets", serialized, f"/api/datasets/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    # --------------------------------------------------------------
    # Upload
    # --------------------------------------------------------------

    @staticmethod
    async def post_upload(
        file_content: bytes,
        file_name: str,
        project_id: str,
        plugin_registry=None,
        dataset_id: str | None = None,
        project: dict | None = None,
    ) -> tuple[dict, int]:
        result = await _upload_uc().upload_file(
            file_content=file_content,
            file_name=file_name,
            project_id=project_id,
            plugin_registry=plugin_registry,
            dataset_id=dataset_id,
            project=project,
        )
        match result:
            case Success(data):
                serialized = serialize(data)
                return wrap_jsonapi_single("uploads", serialized, f"/api/uploads/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    # --------------------------------------------------------------
    # Transforms (part of Dataset aggregate)
    # --------------------------------------------------------------

    @staticmethod
    async def post_transforms(dataset_id: str, transforms: list[dict]) -> tuple[dict, int]:
        result = await _dataset_uc().create_transforms(dataset_id, transforms)
        match result:
            case Success():
                return {"ok": True}, 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_transforms(dataset_id: str, updates: list[dict]) -> tuple[dict, int]:
        result = await _dataset_uc().update_transforms(dataset_id, updates)
        match result:
            case Success():
                return {"ok": True}, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def preview_transform(dataset_id: str, target_column: str, expression_config: dict) -> tuple[dict, int]:
        result = await _dataset_uc().preview_cleaning_transform(dataset_id, target_column, expression_config)
        match result:
            case Success(data):
                return {"data": data}, 200
            case Failure(error):
                return error_response(error)

    # --------------------------------------------------------------
    # Search
    # --------------------------------------------------------------

    @staticmethod
    async def search_datasets(project_id: str, query: str, user) -> tuple[dict, int]:
        result = await _search_uc().search_datasets(project_id, query, user=user)
        match result:
            case Success(data):
                return {"data": data}, 200
            case Failure(error):
                return error_response(error)
