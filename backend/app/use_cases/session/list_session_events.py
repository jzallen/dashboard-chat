"""List persisted replay events for a session (Epic C — dc-x3y.3.2).

Read side of the C.1 / C.2 pair:
  - C.1 (dc-x3y.3.1): worker persists DomainEvents onto the Stream.io thread
    before emitting `turn_done`.
  - C.2 (dc-x3y.3.2): this use case lets a reconnecting client request all
    events since a cursor and replay them in order.

Auth: org-scoped (a session belongs to a project belongs to an org). Cross-org
access returns SessionNotFound to avoid leaking session existence.
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.session.event_replay import (
    SessionEventReader,
    get_session_event_reader,
    is_domain_event,
)
from app.use_cases.session.exceptions import SessionNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


# Hard ceiling — protects the endpoint from accidental large pulls. The
# query-param validator in the router clamps `limit` to this max.
MAX_EVENTS_PER_PAGE = 500
DEFAULT_EVENTS_PER_PAGE = 100


@with_repositories
@handle_returns
async def list_session_events(
    session_id: str,
    user: AuthUser,
    since: str | None = None,
    limit: int = DEFAULT_EVENTS_PER_PAGE,
    *,
    repositories: "RepositoryContainer",
    event_reader: SessionEventReader | None = None,
) -> Result[dict, str]:
    """Return a page of replay-scope DomainEvents for a session.

    Args:
        session_id: The session to replay.
        user: Authenticated caller — must be in the session's org.
        since: Opaque cursor from a prior response (or None for "from start").
        limit: Max events per page (clamped to MAX_EVENTS_PER_PAGE).
        repositories: Auto-injected by `@with_repositories`.
        event_reader: Optional reader override (for tests). Defaults to the
            module-level reader, which is `noop_session_event_reader` in
            production until a real Stream.io adapter is registered.

    Returns:
        Success with `{session_id, events, next_cursor, has_more}` payload, or
        Failure wrapping SessionNotFound (unknown id or cross-org access).
    """
    metadata_repo = repositories.metadata
    session = await metadata_repo.get_session(session_id)
    if not session:
        raise SessionNotFound(session_id)
    if session["org_id"] != user.org_id:
        raise SessionNotFound(session_id)

    reader = event_reader if event_reader is not None else get_session_event_reader()
    page = await reader.get_events(
        stream_thread_id=session["stream_thread_id"],
        since=since,
        limit=min(max(limit, 1), MAX_EVENTS_PER_PAGE),
    )

    # Defense in depth: the agent-side persister only writes DomainEvents, but
    # if a UI directive ever leaks into the durable store (or a future reader
    # implementation reads from a wider source), filter it here per ADR-014.
    domain_events = [e for e in page.events if is_domain_event(e)]

    return {
        "session_id": session_id,
        "events": domain_events,
        "next_cursor": page.next_cursor,
        "has_more": page.has_more,
    }
