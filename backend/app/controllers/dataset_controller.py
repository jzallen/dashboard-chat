"""Controller for dataset operations."""

from typing import Any, Callable, Awaitable

from returns.result import Result, Success, Failure

from ..models.dataset import Dataset
from ..repositories import LakeRepository
from ..schemas import DatasetUpdate
from ..use_cases import dataset as dataset_use_cases


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
        update_data: DatasetUpdate,
    ) -> Result[dict[str, Any], str]:
        """Update a dataset's metadata and transforms."""
        try:
            update_dict = update_data.model_dump(exclude_unset=True)
            result = await dataset_use_cases.update_dataset(dataset_id, update_dict)
            if result is None:
                return Failure("Dataset not found")
            return Success(result)
        except Exception as e:
            return Failure(f"Failed to update dataset: {str(e)}")

    @staticmethod
    async def delete_dataset(
        dataset_id: str,
    ) -> Result[dict[str, str], str]:
        """Delete a dataset and its data table."""
        try:
            deleted = await dataset_use_cases.delete_dataset(dataset_id)
            if not deleted:
                return Failure("Dataset not found")
            return Success({"status": "deleted", "id": dataset_id})
        except Exception as e:
            return Failure(f"Failed to delete dataset: {str(e)}")
