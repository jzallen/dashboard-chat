"""Get organization use case."""

from typing import TYPE_CHECKING

from app.auth import get_auth_user
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_organization(
    *,
    repositories: "RepositoryContainer",
) -> dict | None:
    """Get the current user's organization from the local database.

    Returns:
        Organization dict or None if not found.
    """
    user = get_auth_user()
    if user.org_id is None:
        return None

    metadata_repo = repositories.metadata
    return await metadata_repo.get_organization(user.org_id)
