"""Search datasets by name within a project."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def search_datasets(
    project_id: str,
    query: str,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[dict], str]:
    """Search datasets by name within a project.

    Raises:
        ProjectNotFound: If project does not exist or belongs to another org.
    """
    metadata_repo = repositories.metadata
    project = await metadata_repo.get_project(project_id)
    if not project or project["org_id"] != user.org_id:
        raise ProjectNotFound(project_id)

    return await metadata_repo.search_datasets_by_name(project_id, query)
