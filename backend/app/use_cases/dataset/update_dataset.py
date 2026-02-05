
from typing import Any, TYPE_CHECKING

from returns.result import Result

from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService
from app.use_cases.exceptions import DatasetNotFound
from app.repositories import with_repositories
from app.models.dataset import Dataset

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_dataset(
    dataset_id: str,
    update_dict: dict[str, Any],
    *,
    repositories: 'RepositoryContainer',
) -> Result[Dataset, str]:
    """Update a dataset's metadata and transforms.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    dataset = Dataset(id=dataset_id, transforms=update_dict.pop('transforms', None), **update_dict)

    if not await repositories['metadata_repository'].dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    await repositories['metadata_repository'].update_dataset(dataset_id, **update_dict)

    if dataset.transforms:
        await repositories['metadata_repository'].update_transforms(dataset.transforms)

    return await DatasetService(repositories).fetch_dataset(dataset_id)
