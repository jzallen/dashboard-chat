from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.models.dataset import Dataset
from app.use_cases.exceptions import (
    ProjectIdRequired,
    ProjectNotFound,
)

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer



@with_repositories
@handle_returns
async def list_datasets(project_id: str, *, repositories: 'RepositoryContainer') -> Result[list[Dataset], str]:
    """List all datasets for a project.

    Raises:
        ProjectIdRequired: If project_id is not provided.
    """

    if project_id is None:
        raise ProjectIdRequired()

    if not await repositories["metadata_repository"].project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)

    result = await repositories["metadata_repository"].list_datasets(project_id=project_id)

    return [Dataset.from_record(r) for r in result]

