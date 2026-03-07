from typing import TYPE_CHECKING

from returns.result import Result

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectIdRequired, ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_datasets(
    project_id: str,
    cursor: str | None = None,
    page_size: int = 50,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List all datasets for a project with cursor-based pagination.

    Raises:
        ProjectIdRequired: If project_id is not provided.
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    if project_id is None:
        raise ProjectIdRequired()

    metadata_repo = repositories.metadata

    if not await metadata_repo.project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)

    project = await metadata_repo.get_project(project_id)
    user = get_auth_user()
    if project and project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")

    dataset_records, next_cursor, has_more = await metadata_repo.list_datasets(
        project_id=project_id, cursor=cursor, limit=page_size
    )

    items = [Dataset.from_record(r) for r in dataset_records]
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "page_size": page_size}
