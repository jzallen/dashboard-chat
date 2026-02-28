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
from app.use_cases.dataset.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

DEFAULT_PREVIEW_LIMIT = 10


class DatasetService:
    """Shared dataset operations used by multiple use cases."""

    def __init__(self, repositories: "RepositoryContainer"):
        self._metadata_repo = repositories.metadata
        self._lake_repo = repositories.lake

    async def fetch_and_authorize_dataset(self, dataset_id: str):
        """Fetch a dataset record and verify the current user's org owns its parent project.

        Returns:
            The dataset record if found and authorized.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
            AuthorizationError: If user's org does not own the parent project.
        """
        record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms=False)
        if not record:
            raise DatasetNotFound(dataset_id)
        self._verify_org_access(record, dataset_id)
        return record

    async def fetch_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = DEFAULT_PREVIEW_LIMIT,
    ) -> Dataset:
        """Fetch a dataset record and convert to domain model.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
            AuthorizationError: If user's org does not own the parent project.
        """
        dataset_record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms)

        if not dataset_record:
            raise DatasetNotFound(dataset_id)

        self._verify_org_access(dataset_record, dataset_id)

        dataset = Dataset.from_record(dataset_record, include_transforms=include_transforms)

        if include_preview:
            preview_rows = await asyncio.to_thread(lambda: dataset.query_preview_rows(limit=preview_limit))
            dataset = replace(dataset, preview_rows=preview_rows)

        return dataset

    @staticmethod
    def _verify_org_access(dataset_record, dataset_id: str) -> None:
        """Verify the current user's org owns the dataset's parent project."""
        project = dataset_record.project
        if project is None:
            return
        project_org_id = getattr(project, "org_id", None)
        if project_org_id and project_org_id != get_auth_user().org_id:
            raise AuthorizationError(f"Access denied to dataset {dataset_id}")
