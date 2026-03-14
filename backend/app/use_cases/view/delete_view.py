"""Delete view use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.exceptions import ViewNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def delete_view(
    view_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[bool, str]:
    """Delete a view.

    Args:
        view_id: The UUID of the view to delete.

    Raises:
        ViewNotFound: If view with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    view_dict = await repositories.metadata.get_view(view_id)
    if view_dict is None:
        raise ViewNotFound(view_id)

    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(view_dict["project_id"])

    deleted = await repositories.metadata.delete_view(view_id)
    if not deleted:
        raise ViewNotFound(view_id)

    return True
