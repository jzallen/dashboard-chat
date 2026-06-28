"""Per-request correlation-id binding for the backend.

The correlation id is minted once at the auth-proxy ingress, rides the
``X-Request-Id`` header on every upstream hop, and must surface on log lines
emitted deep inside a use case without being threaded through call signatures.
This module is the Python half of that ambient binding; the Node half is the
``AsyncLocalStorage`` store in ``@dashboard-chat/correlation-id``.

It mirrors ``app.auth.context`` (``_auth_user``) deliberately. The binding is a
``contextvars.ContextVar`` — the async-safe primitive: under ``asyncio`` each
task runs in its own copied ``Context``, so a value ``set()`` while handling one
request is never visible to a concurrently-awaiting request, yet it propagates
across ``await`` boundaries into the use cases the request calls.
(``threading.local`` would leak across awaited coroutines sharing a thread, so it
must not be used here.) The request middleware ``set()``s the id at the top of
the FastAPI stack and the JSON log formatter reads it back via
``get_correlation_id`` to populate ``attributes.correlation_id``.
"""

from contextvars import ContextVar

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def get_correlation_id() -> str | None:
    """Return the correlation id bound to the current request context, if any.

    Returns ``None`` outside any request (startup, background tasks) so the log
    formatter can read it on every record without raising.
    """
    return _correlation_id.get()


def set_correlation_id(correlation_id: str) -> None:
    """Bind ``correlation_id`` to the current request context."""
    _correlation_id.set(correlation_id)


def clear_correlation_id() -> None:
    """Clear any correlation id bound to the current request context."""
    _correlation_id.set(None)
