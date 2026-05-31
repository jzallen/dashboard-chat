"""List sparse datasets for a project (no transforms)."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

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


@handle_returns
@with_repositories
async def list_datasets_for_project(
    project_id: str,
    cursor: str | None = None,
    page_size: int = 50,
    user: AuthUser | None = None,
    archived: bool | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List sparse datasets belonging to a project with cursor-based pagination.

    Authorization is handled at the router layer via authorize_project_access.

    ``archived`` filters by cold-storage state (MR-7): ``None``/``False`` excludes
    archived datasets (the default live view); ``True`` returns ONLY archived datasets
    (the cold-storage list).

    Raises:
        ProjectNotFound: If project does not exist.
    """
    metadata_repo = repositories.metadata
    if not await metadata_repo.project_exists(project_id):
        raise ProjectNotFound(project_id)

    # NOTE (DISTILL RED, MR-7): ``archived`` is accepted but NOT yet threaded into the
    # repository query — DELIVER 07-01 pushes the filter down. Until then the filter
    # tests are RED (archived rows are still returned).
    records, next_cursor, has_more = await metadata_repo.list_datasets(
        project_id, include_transforms=False, cursor=cursor, limit=page_size
    )

    items = [_sparse_dict(r) for r in records]
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "page_size": page_size}
