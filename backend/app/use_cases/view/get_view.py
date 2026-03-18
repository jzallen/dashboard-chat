"""Get view use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.exceptions import ViewNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_view(
    view_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[View, str]:
    """Get a single view by ID.

    Args:
        view_id: The UUID of the view to retrieve.

    Raises:
        ViewNotFound: If view with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    view_dict = await repositories.metadata.get_view(view_id)
    if view_dict is None:
        raise ViewNotFound(view_id)

    # Authorize via the parent project
    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(view_dict["project_id"])

    return View(**{k: v for k, v in view_dict.items() if k in View.__dataclass_fields__})
