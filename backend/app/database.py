"""Async SQLAlchemy database setup."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import select

from .config import get_settings


settings = get_settings()

# Create async engine
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    future=True,
)

# Create async session factory
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""

    pass


async def get_db() -> AsyncSession:
    """Dependency to get database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


# Default IDs for the sample project and dataset
DEFAULT_PROJECT_ID = "default-project-001"
DEFAULT_DATASET_ID = "1592ce82-5f22-4da7-b41b-9fd9fd05770e"


async def init_db() -> None:
    """Initialize database tables and create defaults."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create default project and dataset
    await _create_defaults()


async def _create_defaults() -> None:
    """Create default project if it doesn't exist."""
    from .repositories.metadata import ProjectRecord

    async with async_session() as session:
        # Check if default project exists
        result = await session.execute(
            select(ProjectRecord).where(ProjectRecord.id == DEFAULT_PROJECT_ID)
        )
        project = result.scalar_one_or_none()

        if not project:
            # Create default project
            project = ProjectRecord(
                id=DEFAULT_PROJECT_ID,
                name="Default Project",
                description="Auto-created default project",
            )
            session.add(project)
            await session.commit()


async def close_db() -> None:
    """Close database connections."""
    await engine.dispose()
