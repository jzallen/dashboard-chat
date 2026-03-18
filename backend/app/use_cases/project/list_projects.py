"""List projects use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_projects(
    user: AuthUser,
    cursor: str | None = None,
    page_size: int = 50,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """List all projects with cursor-based pagination."""
    metadata_repo = repositories.metadata
    items, next_cursor, has_more = await metadata_repo.list_projects(org_id=user.org_id, cursor=cursor, limit=page_size)
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "page_size": page_size}
