"""Database context management for use cases.

Provides a context variable to store the current database session,
allowing use cases to access the session without explicit parameter passing.
"""

from contextvars import ContextVar
from functools import wraps
from typing import Callable, TypeVar, ParamSpec

from sqlalchemy.ext.asyncio import AsyncSession

# Context variable to hold the current database session
_db_session: ContextVar[AsyncSession | None] = ContextVar("db_session", default=None)


def get_session() -> AsyncSession:
    """Get the current database session from context.
    
    Raises:
        RuntimeError: If no session is set in the current context.
    """
    session = _db_session.get()
    if session is None:
        raise RuntimeError("No database session in context. Use @with_db or set_session().")
    return session


def set_session(session: AsyncSession) -> None:
    """Set the database session for the current context."""
    _db_session.set(session)


P = ParamSpec("P")
R = TypeVar("R")


def with_db(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that injects the database session from context.
    
    Use cases decorated with @with_db will automatically receive
    the session from the current context, removing the need to
    pass db as an explicit parameter.
    """
    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        db = get_session()
        return await func(db, *args, **kwargs)
    return wrapper
