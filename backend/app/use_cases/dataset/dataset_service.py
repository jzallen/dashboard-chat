"""Shared logic for dataset use cases.

Provides the DatasetService class for operations shared across
get_dataset, update_dataset, etc.
"""

import asyncio
from dataclasses import replace
from typing import TYPE_CHECKING

from app.models.dataset import Dataset
from app.use_cases.dataset.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

DEFAULT_PREVIEW_LIMIT = 10


class DatasetService:
    """Shared dataset operations used by multiple use cases."""

    def __init__(self, repositories: "RepositoryContainer"):
        self._metadata_repo = repositories.metadata
        self._lake_repo = repositories.lake

    async def fetch_dataset_record(self, dataset_id: str):
        """Fetch a dataset record by ID.

        Authorization is handled at the router layer via authorize_dataset_access.

        Returns:
            The dataset record if found.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
        """
        record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms=False)
        if not record:
            raise DatasetNotFound(dataset_id)
        return record

    async def fetch_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = DEFAULT_PREVIEW_LIMIT,
    ) -> Dataset:
        """Fetch a dataset record and convert to domain model.

        Authorization is handled at the router layer via authorize_dataset_access.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
        """
        dataset_record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms)

        if not dataset_record:
            raise DatasetNotFound(dataset_id)

        dataset = Dataset.from_record(dataset_record, include_transforms=include_transforms)

        if include_preview:
            preview_rows = await asyncio.to_thread(lambda: dataset.query_preview_rows(limit=preview_limit))
            dataset = replace(dataset, preview_rows=preview_rows)

        return dataset
