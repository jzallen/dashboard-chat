"""Async SQLAlchemy database setup.

Engine and session factory are lazily initialized via module ``__getattr__``
to avoid importing pydantic_settings and creating a database connection at
module-load time. This keeps ``import app.database`` cheap, which matters
because many backend modules transitively import this module. Actual
initialization happens on first attribute access — typically when the app
starts handling requests or a test fixture requests a session.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""

    pass


# --- Lazy initialization via module __getattr__ ---

_engine = None
_async_session = None


def _init_engine():
    from sqlalchemy import event

    from .config import get_settings

    settings = get_settings()
    eng = create_async_engine(
        settings.database_url,
        echo=settings.debug,
        future=True,
    )

    if "sqlite" in settings.database_url:
        from uuid_utils import uuid7

        @event.listens_for(eng.sync_engine, "connect")
        def _register_sqlite_uuidv7(dbapi_connection, connection_record):
            dbapi_connection.create_function("uuidv7", 0, lambda: str(uuid7()))

    return eng


def __getattr__(name: str):
    global _engine, _async_session
    if name == "engine":
        if _engine is None:
            _engine = _init_engine()
        return _engine
    if name == "async_session":
        if _async_session is None:
            _async_session = async_sessionmaker(
                __getattr__("engine"),
                class_=AsyncSession,
                expire_on_commit=False,
            )
        return _async_session
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


async def get_db() -> AsyncSession:
    """Dependency to get database session."""
    async with __getattr__("async_session")() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables."""
    async with __getattr__("engine").begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Close database connections."""
    if _engine is not None:
        await _engine.dispose()
