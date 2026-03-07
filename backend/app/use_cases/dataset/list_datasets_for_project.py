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
    cursor: str | None = None,
    page_size: int = 50,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List sparse datasets belonging to a project with cursor-based pagination.

    Returns lightweight dataset dicts (no transforms) suitable for
    sidebar/navigation views.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(project_id)

    records, next_cursor, has_more = await repositories.metadata.list_datasets(
        project_id, include_transforms=False, cursor=cursor, limit=page_size
    )

    items = [_sparse_dict(r) for r in records]
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "page_size": page_size}
