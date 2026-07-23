"""List sessions use case."""

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
async def list_sessions(
    project_id: str,
    user: AuthUser,
    cursor: str | None = None,
    page_size: int = 30,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List sessions for a project's memory.

    Args:
        project_id: The project whose sessions to list.
        user: The authenticated user.
        cursor: Pagination cursor.
        page_size: Number of results per page.

    Returns:
        Success with paginated sessions dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata

    memory = await metadata_repo.get_project_memory(project_id)
    if not memory:
        # project_memory is provisioned lazily on first session creation, so a
        # project that has never been chatted in has no row yet. Existence and
        # org ownership are already enforced upstream, so a missing row means
        # "zero sessions" — return an empty page like the sibling reads, not 404.
        return {
            "items": [],
            "next_cursor": None,
            "has_more": False,
            "page_size": page_size,
        }

    if memory["org_id"] != user.org_id:
        raise ProjectNotFound(project_id)

    items, next_cursor, has_more = await metadata_repo.list_sessions(
        memory_id=memory["id"],
        org_id=user.org_id,
        cursor=cursor,
        limit=page_size,
    )

    return {
        "items": items,
        "next_cursor": next_cursor,
        "has_more": has_more,
        "page_size": page_size,
    }
