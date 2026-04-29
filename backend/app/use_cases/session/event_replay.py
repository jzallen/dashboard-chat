"""SessionEventReader port — read persisted DomainEvents off a Stream.io thread.

Mirrors the agent-side `ThreadEventPersister` abstraction (dc-x3y.3.1, see
`agent/lib/chat/threadPersister.ts`). C.1 chose the Stream.io thread itself as
the durable store for replay-scope domain events; this port is the read side
of that contract.

Cursor format is opaque: implementations own it. The noop default returns an
empty page with `next_cursor=None`. The real Stream.io adapter (deferred until
Stream.io credentials are wired through the Python backend's env) will use
Stream.io message IDs as the cursor.

UI directives are filtered out by contract — only DomainEvents (per ADR-014's
stratification) are returned. The agent only writes DomainEvents through
`ThreadEventPersister.persist`, so in practice the durable store should never
contain UI directives in the first place; the read-side filter is defense in
depth.
"""

from dataclasses import dataclass
from typing import Any, Protocol

# DomainEvent type set per ADR-014 — kept in sync with
# agent/lib/chat/threadPersister.ts `DOMAIN_EVENT_TYPES`. UI directives
# (sort_directive, filter_directive, filters_cleared) are explicitly excluded.
DOMAIN_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "transform_applied",
        "row_added",
        "row_deleted",
        "column_renamed",
        "transform_undone",
        "transform_re_enabled",
        "error_occurred",
        "turn_done",
    }
)


def is_domain_event(event: dict[str, Any]) -> bool:
    """True if the event's `type` is a replay-scope DomainEvent (ADR-014)."""
    return event.get("type") in DOMAIN_EVENT_TYPES


@dataclass(frozen=True)
class EventsPage:
    """One page of replay events for a session."""

    events: list[dict[str, Any]]
    next_cursor: str | None
    has_more: bool


class SessionEventReader(Protocol):
    """Reads persisted DomainEvents for a session's Stream.io thread.

    Cursor semantics:
      - `since=None` (or empty string) → from the beginning of the thread.
      - `since=<cursor>` → events strictly after the event identified by cursor.
      - Returned `next_cursor` is the cursor a client should pass to fetch the
        next page; `None` means no more events exist.
    """

    async def get_events(
        self,
        stream_thread_id: str,
        since: str | None,
        limit: int,
    ) -> EventsPage: ...


class _NoopSessionEventReader:
    """Default reader returning an empty page.

    Used in production until Stream.io credentials are wired through env and a
    real adapter is registered (mirrors `noopThreadPersister` on the agent
    side). The endpoint stays live and contract-compliant — clients receive
    `{events: [], next_cursor: null, has_more: false}` — but no replay data is
    served until the adapter is swapped in.
    """

    async def get_events(
        self,
        stream_thread_id: str,
        since: str | None,
        limit: int,
    ) -> EventsPage:
        return EventsPage(events=[], next_cursor=None, has_more=False)


noop_session_event_reader: SessionEventReader = _NoopSessionEventReader()


def get_session_event_reader() -> SessionEventReader:
    """Return the active reader. Patched in tests; production returns noop."""
    return noop_session_event_reader
