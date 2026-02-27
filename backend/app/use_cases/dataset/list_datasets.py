from typing import TYPE_CHECKING

from returns.result import Result

from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.exceptions import (
    ProjectIdRequired,
    ProjectNotFound,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_datasets(project_id: str, *, repositories: "RepositoryContainer") -> Result[list[Dataset], str]:
    """List all datasets for a project.

    Raises:
        ProjectIdRequired: If project_id is not provided.
        ProjectNotFound: If project does not exist.
    """
    if project_id is None:
        raise ProjectIdRequired()

    metadata_repo = repositories["metadata_repository"]

    if not await metadata_repo.project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)

    dataset_records = await metadata_repo.list_datasets(project_id=project_id)

    return [Dataset.from_record(r) for r in dataset_records]
