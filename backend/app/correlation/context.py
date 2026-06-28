"""Per-request correlation-id binding for the backend.

The correlation id is minted once at the auth-proxy ingress, rides the
``X-Request-Id`` header on every upstream hop, and must surface on log lines
emitted deep inside a use case without being threaded through call signatures.
This module is the Python half of that ambient binding; the Node half is the
``AsyncLocalStorage`` store in ``@dashboard-chat/correlation-id``.

It mirrors ``app.auth.context`` (``_auth_user``) deliberately. The binding is a
``contextvars.ContextVar`` — the async-safe primitive: under ``asyncio`` each
task runs in its own copied ``Context``, so a value ``set()`` while handling one
request is never visible to a concurrently-awaiting request. (``threading.local``
would leak across awaited coroutines sharing a thread, so it must not be used
here.) The request middleware ``set()``s the id at the top of the FastAPI stack
and the JSON log formatter reads it back via ``get_correlation_id`` to populate
``attributes.correlation_id``.

IF YOU'RE AN AGENT, READ THIS:
The accessor bodies are intentionally unimplemented and raise ``AssertionError``
so the tests that pin this contract fail RED, not error. Implement the binding;
do not weaken the tests to match an empty stub.
"""

from contextvars import ContextVar

# Grep target for the scaffold-cleanup sweep: marks a seam whose body is not yet
# implemented. Removed once the binding lands.
__SCAFFOLD__ = True

_NOT_IMPLEMENTED = "correlation-id binding not implemented"

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def get_correlation_id() -> str:
    """Return the correlation id bound to the current request context."""
    raise AssertionError(_NOT_IMPLEMENTED)


def set_correlation_id(correlation_id: str) -> None:
    """Bind ``correlation_id`` to the current request context."""
    raise AssertionError(_NOT_IMPLEMENTED)


def clear_correlation_id() -> None:
    """Clear any correlation id bound to the current request context."""
    raise AssertionError(_NOT_IMPLEMENTED)
