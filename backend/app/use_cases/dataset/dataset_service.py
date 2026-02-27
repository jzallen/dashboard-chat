"""Shared logic for dataset use cases.

Provides the DatasetService class for operations shared across
get_dataset, update_dataset, etc.
"""

import asyncio
from dataclasses import replace
from typing import TYPE_CHECKING

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.models.dataset import Dataset
from app.use_cases.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


class DatasetService:
    """Shared dataset operations used by multiple use cases."""

    def __init__(self, repositories: "RepositoryContainer"):
        self._metadata_repo = repositories["metadata_repository"]
        self._lake_repo = repositories["lake_repository"]

    async def fetch_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> Dataset:
        """Fetch a dataset record and convert to domain model.

        Preview rows are queried through the staging SQL (with transforms
        applied) so the table reflects cleaned/filtered data.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
            AuthorizationError: If user's org does not own the parent project.
        """
        dataset_record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms)

        if not dataset_record:
            raise DatasetNotFound(dataset_id)

        user = get_auth_user()
        if (
            dataset_record.project
            and hasattr(dataset_record.project, "org_id")
            and dataset_record.project.org_id
            and dataset_record.project.org_id != user.org_id
        ):
            raise AuthorizationError(f"Access denied to dataset {dataset_id}")

        dataset = Dataset.from_record(dataset_record, include_transforms=include_transforms)

        if include_preview:
            preview_rows = await asyncio.to_thread(lambda: dataset.query_preview_rows(limit=preview_limit))
            dataset = replace(dataset, preview_rows=preview_rows)

        return dataset
