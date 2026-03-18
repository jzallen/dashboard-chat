"""List views use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_views(
    project_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[View], str]:
    """List all views for a project.

    Args:
        project_id: The parent project UUID.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(project_id)

    view_records = await repositories.metadata.list_views_by_project(project_id)
    return [View.from_record(r) for r in view_records]
