"""Repository layer for data access and persistence.

Provides database context management, session handling,
and repository implementations for metadata persistence.
"""

from contextvars import ContextVar
from functools import wraps
from typing import Callable, TypeVar, ParamSpec, Self

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..exceptions import MetadataRepositoryError

# Import ORM models to ensure SQLAlchemy relationships are resolved
from .project_record import ProjectRecord  # noqa: F401
from .dataset_record import DatasetRecord  # noqa: F401
from .transform_record import TransformRecord  # noqa: F401

from .metadata_repository import MetadataRepository

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

    SQLAlchemy errors are caught and re-raised as MetadataRepositoryError.
    """
    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        db = get_session()
        try:
            return await func(db, *args, **kwargs)
        except SQLAlchemyError as e:
            raise MetadataRepositoryError(str(e), cause=e) from e
    return wrapper


class RestrictedSession:
    """A restricted session that prevents commit and rollback operations.

    This ensures that transaction management is handled
    at the router/controller level to ensure transactional consistency.
    """
    def __init__(self, session: AsyncSession) -> Self:
        self.flush = session.flush
        self.execute = session.execute
        self.refresh = session.refresh


class RepositoryContainer:
    """Dependency container that lazily instantiates wrapped repositories."""
    
    def __init__(self, db: RestrictedSession) -> Self:
        self._db = db
        self._cache: dict[str, Callable[[AsyncSession], object]] = {}
        self._registry: dict[str, type] = {
            'metadata_repository': MetadataRepository,
        }
    
    def __getitem__(self, name: str) -> object:
        if name not in self._registry:
            raise KeyError(f"Unknown repository: {name}")

        return self._registry[name](self._db)


def with_repositories(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that injects a repository container into kwargs.
    
    Repositories are accessed via kwargs['repositories']['repo_name'].
    """
    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        db = get_session()
        kwargs['repositories'] = RepositoryContainer(RestrictedSession(db))
        result = await func(*args, **kwargs)
        try:
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise e
        return result
    return wrapper
