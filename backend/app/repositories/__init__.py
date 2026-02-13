"""Repository layer for data access and persistence.

Provides database context management, session handling,
and repository implementations for metadata persistence.
"""

from contextvars import ContextVar
from functools import partial, wraps
from typing import Callable, TypeVar, ParamSpec, Self, Union

from sqlalchemy.ext.asyncio import AsyncSession

from .metadata import MetadataRepository
from .lake import LakeRepository, MinIOLakeRepository
from .outbox import OutboxRepository

# Context variable to hold the current database session
_db_session: ContextVar[AsyncSession | None] = ContextVar("db_session", default=None)


Repository = Union[MetadataRepository, LakeRepository, OutboxRepository]


def get_session() -> AsyncSession:
    """Get the current database session from context.

    Raises:
        RuntimeError: If no session is set in the current context.
    """
    session = _db_session.get()
    if session is None:
        raise RuntimeError("No database session in context. Use set_session().")
    return session


def set_session(session: AsyncSession) -> None:
    """Set the database session for the current context."""
    _db_session.set(session)


P = ParamSpec("P")
R = TypeVar("R")


class RestrictedSession:
    """A restricted session that prevents commit and rollback operations.

    This ensures that transaction management is handled
    at the router/controller level to ensure transactional consistency.
    """
    def __init__(self, session: AsyncSession) -> Self:
        self.flush = session.flush
        self.execute = session.execute
        self.refresh = session.refresh
        self.add = session.add
        self.delete = session.delete
        self.begin_nested = session.begin_nested


class RepositoryContainer:
    """Dependency container that lazily instantiates wrapped repositories."""

    def __init__(self, db: RestrictedSession, overrides: dict[str, Callable[[], object]] | None = None) -> Self:
        self._registry: dict[str, Callable[[], object]] = {
            'metadata_repository': partial(MetadataRepository, db),
            'lake_repository': MinIOLakeRepository,
            'outbox_repository': partial(OutboxRepository, db),
            **(overrides or {}),
        }
        self._cache: dict[str, object] = {}

    def __getitem__(self, name: str) -> object:
        if name not in self._registry:
            raise KeyError(f"Unknown repository: {name}")

        if name not in self._cache:
            self._cache[name] = self._registry[name]()

        return self._cache[name]


def with_repositories(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that injects a repository container into kwargs.

    Repositories are accessed via kwargs['repositories']['repo_name'].
    Callers can pass 'repositories' kwarg with either:
    - A RepositoryContainer instance (used directly)
    - A dict of overrides to substitute implementations
    - None (creates default container)
    """
    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        db = get_session()
        overrides = kwargs.pop('repositories', None)
        match overrides:
            case RepositoryContainer():
                kwargs['repositories'] = overrides
            case dict():
                kwargs['repositories'] = RepositoryContainer(RestrictedSession(db), overrides)
            case _:
                kwargs['repositories'] = RepositoryContainer(RestrictedSession(db))
        result = await func(*args, **kwargs)
        try:
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise e
        return result
    return wrapper
