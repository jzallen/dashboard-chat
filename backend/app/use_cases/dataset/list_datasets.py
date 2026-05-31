from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectIdRequired, ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def list_datasets(
    project_id: str,
    cursor: str | None = None,
    page_size: int = 50,
    user: AuthUser | None = None,
    archived: bool | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List all datasets for a project with cursor-based pagination.

    Authorization is handled at the router layer via authorize_project_access.

    ``archived`` filters by cold-storage state (MR-7): ``None``/``False`` excludes
    archived datasets (the default live view); ``True`` returns ONLY archived datasets
    (the cold-storage list).

    Raises:
        ProjectIdRequired: If project_id is not provided.
        ProjectNotFound: If project does not exist.
    """
    if project_id is None:
        raise ProjectIdRequired()

    metadata_repo = repositories.metadata

    if not await metadata_repo.project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)

    # NOTE (DISTILL RED, MR-7): ``archived`` is accepted but NOT yet threaded into the
    # repository query — DELIVER 07-01 pushes the filter down. Until then the filter
    # tests are RED (archived rows are still returned).
    dataset_records, next_cursor, has_more = await metadata_repo.list_datasets(
        project_id=project_id, cursor=cursor, limit=page_size
    )

    items = [Dataset.from_record(r) for r in dataset_records]
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "page_size": page_size}
