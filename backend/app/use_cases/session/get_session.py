"""Get-session use case (J-002 MR-2 — DWD-2 read path).

Reads a single session by id, returning metadata including
`active_dataset_id` so the ui-state tier's `resumeSession` actor can
populate `active_scope.resource_*` atomically with the transcript per
US-205 / IC-J002-3.

Auth: org-scoped — SessionNotFound for unknown OR cross-org access (existence
is not leaked).
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns

from .exceptions import SessionNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def get_session(
    session_id: str,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Return the session metadata dict, or Failure(SessionNotFound)."""
    metadata_repo = repositories.metadata

    session = await metadata_repo.get_session(session_id)
    if not session:
        raise SessionNotFound(session_id)
    if session["org_id"] != user.org_id:
        raise SessionNotFound(session_id)
    return session
