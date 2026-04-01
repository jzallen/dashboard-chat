"""Update session use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns

from .exceptions import SessionAccessDenied, SessionNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_session(
    session_id: str,
    update_data: dict[str, Any],
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Update a session's metadata (title, last_active_at).

    Only the session owner can update.

    Args:
        session_id: The session to update.
        update_data: Fields to update (title, last_active_at).
        user: The authenticated user.

    Returns:
        Success with updated session dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata

    session = await metadata_repo.get_session(session_id)
    if not session:
        raise SessionNotFound(session_id)

    if session["org_id"] != user.org_id:
        raise SessionNotFound(session_id)

    if session["owner_id"] != user.id:
        raise SessionAccessDenied(session_id)

    # Only allow updating title and last_active_at
    allowed_fields = {"title", "last_active_at"}
    filtered = {k: v for k, v in update_data.items() if k in allowed_fields}

    if not filtered:
        return session

    return await metadata_repo.update_session(session_id, filtered)
