"""Dataset Ingestion HTTP controller (Dataset Ingestion bounded context).

Thin HTTP adapter for the largest bounded context — the Upload→Dataset→Transform
pipeline plus dataset search within a project. The routers depend on this class
directly; there is deliberately no roll-up through a god ``HTTPController``.

Each endpoint declares its use case as an injected, typed dependency: a
keyword-only ``*_func`` parameter defaulting to the real use case from
``app.use_cases.dataset`` / ``app.use_cases.upload``, typed against a ``Protocol``
that captures the call interface the controller relies on. Production passes
nothing (the defaults bind); tests inject a function matching the Protocol, so a
fake use case needs no module-level monkeypatching to intercept the call.
"""

from typing import Any, Protocol, TypedDict

from returns.result import Failure, Result, Success

from app.use_cases import dataset as dataset_use_cases
from app.use_cases import upload as upload_use_cases
from app.use_cases.dataset import search_datasets as search_datasets_module

from ._result_mapper import error_response, serialize
from .response_wrapper import wrap_jsonapi_list, wrap_jsonapi_single


class DatasetListPage(TypedDict):
    """One cursor-paginated page of datasets, as returned by a list use case.

    Listing wraps its rows in a pagination envelope that the controller unpacks
    into the JSON:API list response. ``items`` are models for ``list_datasets``
    (serialized here) and already-sparse dicts for ``list_datasets_for_project``.
    """

    items: list
    next_cursor: str | None
    has_more: bool
    page_size: int


class ListDatasetsProtocol(Protocol):
    """Call interface for the list-datasets use case."""

    async def __call__(
        self,
        project_id: str,
        *,
        cursor: str | None = None,
        page_size: int = 50,
        archived: bool | None = None,
    ) -> Result[DatasetListPage, Any]: ...


class ListDatasetsForProjectProtocol(Protocol):
    """Call interface for the list-datasets-for-project use case."""

    async def __call__(
        self,
        project_id: str,
        *,
        cursor: str | None = None,
        page_size: int = 50,
        archived: bool | None = None,
    ) -> Result[DatasetListPage, Any]: ...


class GetDatasetProtocol(Protocol):
    """Call interface for the get-dataset use case."""

    async def __call__(
        self,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> Result: ...


class UpdateDatasetProtocol(Protocol):
    """Call interface for the update-dataset use case."""

    async def __call__(self, dataset_id: str, update_dict: dict[str, Any]) -> Result: ...


class ArchiveDatasetProtocol(Protocol):
    """Call interface for the archive-dataset use case."""

    async def __call__(self, dataset_id: str) -> Result: ...


class RestoreDatasetProtocol(Protocol):
    """Call interface for the restore-dataset use case."""

    async def __call__(self, dataset_id: str) -> Result: ...


class CreateDatasetFromUploadProtocol(Protocol):
    """Call interface for the create-dataset-from-upload use case."""

    async def __call__(
        self,
        *,
        upload_id: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
        plugin_registry: Any = None,
        choices: dict[str, str] | None = None,
    ) -> Result: ...


class UploadFileProtocol(Protocol):
    """Call interface for the upload-file use case."""

    async def __call__(
        self,
        *,
        file_content: bytes,
        file_name: str,
        project_id: str,
        plugin_registry: Any = None,
        dataset_id: str | None = None,
        project: dict | None = None,
    ) -> Result: ...


class CreateTransformsProtocol(Protocol):
    """Call interface for the create-transforms use case."""

    async def __call__(self, dataset_id: str, transforms_input: list[dict]) -> Result: ...


class UpdateTransformsProtocol(Protocol):
    """Call interface for the update-transforms use case."""

    async def __call__(self, dataset_id: str, updates: list[dict]) -> Result: ...


class PreviewCleaningTransformProtocol(Protocol):
    """Call interface for the preview-cleaning-transform use case."""

    async def __call__(
        self, dataset_id: str, target_column: str, expression_config: dict
    ) -> Result: ...


class SearchDatasetsProtocol(Protocol):
    """Call interface for the search-datasets use case."""

    async def __call__(self, project_id: str, query: str, user: Any) -> Result: ...


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
        archived: bool | None = None,
        *,
        list_datasets_func: ListDatasetsProtocol = dataset_use_cases.list_datasets,
    ) -> tuple[dict, int]:
        result = await list_datasets_func(project_id, cursor=cursor, page_size=page_size, archived=archived)
        match result:
            case Success(datasets_page):
                items = [serialize(i) for i in datasets_page["items"]]
                resp = wrap_jsonapi_list(
                    "datasets",
                    items,
                    "/api/datasets",
                    datasets_page["page_size"],
                    datasets_page["next_cursor"],
                    datasets_page["has_more"],
                )
                return resp, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def list_project_datasets(
        project_id: str,
        cursor: str | None = None,
        page_size: int = 50,
        archived: bool | None = None,
        *,
        list_datasets_for_project_func: ListDatasetsForProjectProtocol = dataset_use_cases.list_datasets_for_project,
    ) -> tuple[dict, int]:
        result = await list_datasets_for_project_func(
            project_id, cursor=cursor, page_size=page_size, archived=archived
        )
        match result:
            case Success(datasets_page):
                resp = wrap_jsonapi_list(
                    "datasets",
                    datasets_page["items"],
                    f"/api/projects/{project_id}/datasets",
                    datasets_page["page_size"],
                    datasets_page["next_cursor"],
                    datasets_page["has_more"],
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
        *,
        get_dataset_func: GetDatasetProtocol = dataset_use_cases.get_dataset,
    ) -> tuple[dict, int]:
        result = await get_dataset_func(dataset_id, include_transforms, include_preview, preview_limit)
        match result:
            case Success(dataset):
                return wrap_jsonapi_single("datasets", serialize(dataset), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_dataset(
        dataset_id: str,
        *,
        update_dataset_func: UpdateDatasetProtocol = dataset_use_cases.update_dataset,
        **kwargs,
    ) -> tuple[dict, int]:
        result = await update_dataset_func(dataset_id, kwargs)
        match result:
            case Success(updated_dataset):
                return wrap_jsonapi_single("datasets", serialize(updated_dataset), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def archive_dataset(
        dataset_id: str,
        *,
        archive_dataset_func: ArchiveDatasetProtocol = dataset_use_cases.archive_dataset,
    ) -> tuple[dict, int]:
        """Move a dataset to cold storage (MR-7)."""
        result = await archive_dataset_func(dataset_id)
        match result:
            case Success(archived_dataset):
                return wrap_jsonapi_single("datasets", serialize(archived_dataset), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def restore_dataset(
        dataset_id: str,
        *,
        restore_dataset_func: RestoreDatasetProtocol = dataset_use_cases.restore_dataset,
    ) -> tuple[dict, int]:
        """Bring a dataset back from cold storage (MR-7)."""
        result = await restore_dataset_func(dataset_id)
        match result:
            case Success(restored_dataset):
                return wrap_jsonapi_single("datasets", serialize(restored_dataset), f"/api/datasets/{dataset_id}"), 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def post_dataset(
        upload_id: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
        plugin_registry=None,
        choices: dict[str, str] | None = None,
        *,
        create_dataset_func: CreateDatasetFromUploadProtocol = dataset_use_cases.create_dataset_from_upload,
    ) -> tuple[dict, int]:
        result = await create_dataset_func(
            upload_id=upload_id,
            partition_fields=partition_fields,
            description=description,
            plugin_registry=plugin_registry,
            choices=choices,
        )
        match result:
            case Success(created_dataset):
                serialized = serialize(created_dataset)
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
        *,
        upload_file_func: UploadFileProtocol = upload_use_cases.upload_file,
    ) -> tuple[dict, int]:
        result = await upload_file_func(
            file_content=file_content,
            file_name=file_name,
            project_id=project_id,
            plugin_registry=plugin_registry,
            dataset_id=dataset_id,
            project=project,
        )
        match result:
            case Success(upload):
                serialized = serialize(upload)
                return wrap_jsonapi_single("uploads", serialized, f"/api/uploads/{serialized['id']}"), 201
            case Failure(error):
                return error_response(error)

    # --------------------------------------------------------------
    # Transforms (part of Dataset aggregate)
    # --------------------------------------------------------------

    @staticmethod
    async def post_transforms(
        dataset_id: str,
        transforms: list[dict],
        *,
        create_transforms_func: CreateTransformsProtocol = dataset_use_cases.create_transforms,
    ) -> tuple[dict, int]:
        result = await create_transforms_func(dataset_id, transforms)
        match result:
            case Success():
                return {"ok": True}, 201
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def patch_transforms(
        dataset_id: str,
        updates: list[dict],
        *,
        update_transforms_func: UpdateTransformsProtocol = dataset_use_cases.update_transforms,
    ) -> tuple[dict, int]:
        result = await update_transforms_func(dataset_id, updates)
        match result:
            case Success():
                return {"ok": True}, 200
            case Failure(error):
                return error_response(error)

    @staticmethod
    async def preview_transform(
        dataset_id: str,
        target_column: str,
        expression_config: dict,
        *,
        preview_transform_func: PreviewCleaningTransformProtocol = dataset_use_cases.preview_cleaning_transform,
    ) -> tuple[dict, int]:
        result = await preview_transform_func(dataset_id, target_column, expression_config)
        match result:
            case Success(preview):
                return {"data": preview}, 200
            case Failure(error):
                return error_response(error)

    # --------------------------------------------------------------
    # Search
    # --------------------------------------------------------------

    @staticmethod
    async def search_datasets(
        project_id: str,
        query: str,
        user,
        *,
        search_datasets_func: SearchDatasetsProtocol = search_datasets_module.search_datasets,
    ) -> tuple[dict, int]:
        result = await search_datasets_func(project_id, query, user=user)
        match result:
            case Success(matches):
                return {"data": matches}, 200
            case Failure(error):
                return error_response(error)
