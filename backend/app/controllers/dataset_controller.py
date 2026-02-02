"""Controller for dataset operations."""

from typing import Any, Callable, Awaitable

from returns.result import Result, Success, Failure

from ..models.dataset import Dataset
from ..repositories import LakeRepository
from ..use_cases import dataset as dataset_use_cases
from ..use_cases import upload as upload_use_cases


class DatasetController:
    """Controller for dataset operations."""

    @staticmethod
    async def list_datasets(
        project_id: str | None = None,
        list_datasets_func: Callable[[str | None], Awaitable[list[Dataset]]] = dataset_use_cases.list_datasets,
    ) -> Result[list[Dataset], str]:
        """List all datasets, optionally filtered by project."""
        try:
            datasets = await list_datasets_func(project_id)
            return Success(datasets)
        except Exception as e:
            return Failure(f"Failed to list datasets: {str(e)}")

    @staticmethod
    async def get_dataset(
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
        repositories: dict[str, Callable[[], LakeRepository]] | None = None,
    ) -> Result[Dataset, str]:
        """Get a single dataset by ID with optional transforms and preview."""
        try:
            dataset = await dataset_use_cases.get_dataset(
                dataset_id, include_transforms, include_preview, preview_limit,
                repositories=repositories,
            )
            return Success(dataset)
        except Exception as e:
            return Failure(str(e))

    @staticmethod
    async def upload_dataset(
        file_content: bytes,
        file_name: str,
        project_id: str,
        name: str,
        description: str | None = None,
    ) -> Result[dict[str, Any], str]:
        """Upload a CSV file and create a dataset."""
        try:
            result = await dataset_use_cases.upload_dataset(
                file_content, file_name, project_id, name, description
            )
            return Success(result)
        except ValueError as e:
            return Failure(str(e))
        except Exception as e:
            return Failure(f"Failed to process file: {str(e)}")

    @staticmethod
    async def update_dataset(
        dataset_id: str,
        repositories: dict[str, Any] | None = None,
        **dataset_kwargs: Any,
    ) -> Result[Dataset, str]:
        """Update a dataset's metadata and transforms."""
        try:
            result = await dataset_use_cases.update_dataset(
                dataset_id, dataset_kwargs, repositories=repositories
            )
            return Success(result)
        except Exception as e:
            return Failure(str(e))

    # -------------------------------------------------------------------------
    # Upload operations
    # -------------------------------------------------------------------------

    @staticmethod
    async def upload_file(
        file_content: bytes,
        file_name: str,
        project_id: str,
        dataset_id: str | None = None,
    ) -> Result[dict[str, Any], str]:
        """Upload a file and create an UploadEvent with inferred schema.

        Step 1 of the upload flow.
        """
        try:
            result = await upload_use_cases.upload_file(
                file_content, file_name, project_id, dataset_id
            )
            return Success(result)
        except ValueError as e:
            return Failure(str(e))
        except Exception as e:
            return Failure(f"Failed to upload file: {str(e)}")

    @staticmethod
    async def get_upload(
        upload_id: str,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> Result[dict[str, Any], str]:
        """Get an upload event by ID with optional preview."""
        try:
            result = await upload_use_cases.get_upload(
                upload_id, include_preview, preview_limit
            )
            return Success(result)
        except upload_use_cases.UploadNotFound as e:
            return Failure(str(e))
        except Exception as e:
            return Failure(str(e))

    @staticmethod
    async def list_uploads(
        project_id: str | None = None,
        dataset_id: str | None = None,
    ) -> Result[list[dict[str, Any]], str]:
        """List upload events, optionally filtered by project or dataset."""
        try:
            result = await upload_use_cases.list_uploads(project_id, dataset_id)
            return Success(result)
        except Exception as e:
            return Failure(f"Failed to list uploads: {str(e)}")

    @staticmethod
    async def create_dataset_from_upload(
        upload_id: str,
        project_id: str,
        name: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
    ) -> Result[dict[str, Any], str]:
        """Create a dataset from an upload event.

        Step 2 of the upload flow.
        """
        try:
            result = await upload_use_cases.create_dataset_from_upload(
                upload_id, project_id, name, partition_fields, description
            )
            return Success(result)
        except upload_use_cases.UploadNotFound as e:
            return Failure(str(e))
        except upload_use_cases.UploadAlreadyProcessed as e:
            return Failure(str(e))
        except ValueError as e:
            return Failure(str(e))
        except Exception as e:
            return Failure(f"Failed to create dataset: {str(e)}")

