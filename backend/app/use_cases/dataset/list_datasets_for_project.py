"""List sparse datasets for a project (no transforms)."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


def _sparse_dict(record) -> dict:
    """Convert a DatasetRecord to a sparse dict for API responses."""
    return {
        "id": record.id,
        "name": record.name,
        "link": f"/api/datasets/{record.id}",
        "description": record.description,
        "schema_config": record.schema_config,
    }


@with_repositories
@handle_returns
async def list_datasets_for_project(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[dict], str]:
    """List sparse datasets belonging to a project.

    Returns lightweight dataset dicts (no transforms) suitable for
    sidebar/navigation views.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(project_id)

    records = await repositories.metadata.list_datasets(project_id, include_transforms=False)

    return [_sparse_dict(r) for r in records]
