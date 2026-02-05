
from functools import wraps
from logging import getLogger
from returns.result import Result, Success, Failure
from app.repositories import RepositoryContainer, with_repositories
from app.models.dataset import Dataset
from app.use_cases.exceptions import (
    ProjectIdRequired,
    ProjectNotFound,
)
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = getLogger(__name__)

def handle_returns(func):
    """Decorator to handle functions returning Result types."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            result = await func(*args, **kwargs)
        except Exception as e:
            logger.exception("Error in %s: %s", func.__name__, str(e))
            return Failure(f"[list_datasets] {str(e)}")
        else:
            return Success(result)

    return wrapper



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

