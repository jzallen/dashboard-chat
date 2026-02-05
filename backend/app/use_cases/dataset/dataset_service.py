"""Shared logic for dataset use cases.

Provides common utilities (handle_returns decorator) and the DatasetService
class for operations shared across get_dataset, update_dataset, etc.
"""

from functools import wraps
from logging import getLogger
from typing import TYPE_CHECKING

from returns.result import Success, Failure

from app.use_cases.exceptions import DatasetNotFound
from app.models.dataset import Dataset

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = getLogger(__name__)


def handle_returns(func):
    """Decorator that wraps use-case return values in Success/Failure."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            result = await func(*args, **kwargs)
        except Exception as e:
            logger.exception("Error in %s: %s", func.__name__, str(e))
            return Failure(f"[{func.__name__}] {str(e)}")
        else:
            return Success(result)

    return wrapper


class DatasetService:
    """Shared dataset operations used by multiple use cases."""

    def __init__(self, repositories: 'RepositoryContainer'):
        self._metadata_repo = repositories['metadata_repository']
        self._lake_repo = repositories['lake_repository']

    async def fetch_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> Dataset:
        """Fetch a dataset record and convert to domain model.

        Raises:
            DatasetNotFound: If dataset with given ID does not exist.
        """
        dataset_record = await self._metadata_repo.get_dataset_record(dataset_id, include_transforms)

        if not dataset_record:
            raise DatasetNotFound(dataset_id)

        preview_rows: list[dict] = []
        if include_preview:
            preview_rows = self._lake_repo.read_parquet_preview(
                dataset_record.storage_path, limit=preview_limit
            )

        return Dataset.from_record(
            dataset_record, preview_rows=preview_rows, include_transforms=include_transforms
        )
