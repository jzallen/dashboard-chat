from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.dataset.exceptions import DatasetNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_dataset(
    dataset_id: str,
    update_dict: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[Dataset, str]:
    """Update a dataset's metadata.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    metadata_repo = repositories.metadata

    if not await metadata_repo.dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    if update_dict:
        await metadata_repo.update_dataset(dataset_id, **update_dict)

    return await DatasetService(repositories).fetch_dataset(dataset_id)
