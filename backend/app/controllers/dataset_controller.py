"""Controller for dataset operations."""

from typing import Any, Callable, Awaitable

from returns.result import Result, Success, Failure

from ..models.dataset import Dataset
from ..repositories import Repository
from app.use_cases import dataset
from ..use_cases import upload as upload_use_cases


class DatasetController:
    """Controller for dataset operations."""

    @staticmethod
    async def list_datasets(
        project_id: str,
        repositories: dict[str, Callable[[], Repository]] | None = None,
    ) -> Result[list[Dataset], str]:
        """List all datasets, optionally filtered by project."""
        return await dataset.list_datasets(project_id, repositories=repositories)

    @staticmethod
    async def get_dataset(
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
        repositories: dict[str, Callable[[], Repository]] | None = None,
    ) -> Result[Dataset, str]:
        """Get a single dataset by ID with optional transforms and preview."""
    
        return await dataset.get_dataset(
            dataset_id, include_transforms, include_preview, preview_limit,
            repositories=repositories,
        )

    @staticmethod
    async def update_dataset(
        dataset_id: str,
        repositories: dict[str, Any] | None = None,
        **dataset_kwargs: Any,
    ) -> Result[Dataset, str]:
        """Update a dataset's metadata and transforms."""
        return await dataset.update_dataset(
            dataset_id, dataset_kwargs, repositories=repositories
        )

    # -------------------------------------------------------------------------
    # Upload operations
    # -------------------------------------------------------------------------

    @staticmethod
    async def upload_file(
        file_content: bytes,
        file_name: str,
        project_id: str,
        dataset_id: str | None = None,
        repositories: dict[str, Callable[[], Repository]] | None = None,
    ) -> Result[dict[str, Any], str]:
        """Upload a file and create an UploadEvent with inferred schema.

        Step 1 of the upload flow.
        """
        return await upload_use_cases.upload_file(
            file_content=file_content,
            file_name=file_name,
            project_id=project_id,
            dataset_id=dataset_id,
            repositories=repositories,
        )

    @staticmethod
    async def create_dataset_from_upload(
        upload_id: str,
        name: str,
        partition_fields: list[str] | None = None,
        description: str | None = None,
        repositories: dict[str, Callable[[], Repository]] | None = None,
    ) -> Result[Dataset, str]:
        """Create a dataset from an upload event.

        Step 2 of the upload flow.
        """
        return await dataset.create_dataset_from_upload(
            upload_id=upload_id,
            name=name,
            partition_fields=partition_fields,
            description=description,
            repositories=repositories,
        )

