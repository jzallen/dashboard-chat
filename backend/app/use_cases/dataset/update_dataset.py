
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
    transforms_input = update_dict.pop('transforms', None)

    if not await repositories['metadata_repository'].dataset_exists(dataset_id):
        raise DatasetNotFound(dataset_id)

    if update_dict:
        await repositories['metadata_repository'].update_dataset(dataset_id, **update_dict)

    if transforms_input:
        repo = repositories['metadata_repository']
        for t in transforms_input:
            if t.get('id') and t.get('delete'):
                await repo.delete_transform(t['id'])
            elif t.get('id'):
                await repo.update_transform(t['id'], t)
            else:
                await repo.create_transform(
                    dataset_id=dataset_id,
                    name=t['name'],
                    condition_json=t['condition_json'],
                    condition_sql=t.get('condition_sql', ''),
                    description=t.get('description'),
                    nl_prompt=t.get('nl_prompt'),
                )

    return await DatasetService(repositories).fetch_dataset(dataset_id)
