"""Update view use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.dependency_service import DependencyService
from app.use_cases.view.exceptions import ViewNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_view(
    view_id: str,
    update_data: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[View, str]:
    """Update a view.

    Args:
        view_id: The UUID of the view to update.
        update_data: Fields to update.

    Raises:
        ViewNotFound: If view with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If updated source refs point to non-existent entities.
        CircularDependency: If updated source refs would create a cycle.
    """
    view_dict = await repositories.metadata.get_view(view_id)
    if view_dict is None:
        raise ViewNotFound(view_id)

    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(view_dict["project_id"])

    # Re-validate source_refs if they are being changed
    if "source_refs" in update_data and update_data["source_refs"] is not None:
        dep_svc = DependencyService(repositories.metadata)
        await dep_svc.validate_source_refs(update_data["source_refs"], view_dict["project_id"])
        await dep_svc.check_circular_dependencies(view_id, update_data["source_refs"])

    updated = await repositories.metadata.update_view(view_id, **update_data)
    if updated is None:
        raise ViewNotFound(view_id)

    return View.from_record(updated)
