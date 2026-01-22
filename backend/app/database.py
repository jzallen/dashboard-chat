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
DEFAULT_DATASET_ID = "default-dataset-001"


async def init_db() -> None:
    """Initialize database tables and create defaults."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Create default project and dataset
    await _create_defaults()


async def _create_defaults() -> None:
    """Create default project and dataset if they don't exist."""
    from .models import Project, Dataset
    from .services.duckdb_service import (
        create_sample_database,
        get_table_schema,
        DATA_DIR,
    )

    async with async_session() as session:
        # Check if default project exists
        result = await session.execute(
            select(Project).where(Project.id == DEFAULT_PROJECT_ID)
        )
        project = result.scalar_one_or_none()

        if not project:
            # Create default project
            project = Project(
                id=DEFAULT_PROJECT_ID,
                name="Default Project",
                description="Auto-created default project for sample data",
            )
            session.add(project)
            await session.flush()

        # Check if default dataset exists
        result = await session.execute(
            select(Dataset).where(Dataset.id == DEFAULT_DATASET_ID)
        )
        dataset = result.scalar_one_or_none()

        if not dataset:
            # Ensure sample DuckDB exists and get its schema
            db_path = create_sample_database()
            schema_config = get_table_schema(db_path, "products")

            # Create default dataset
            dataset = Dataset(
                id=DEFAULT_DATASET_ID,
                project_id=DEFAULT_PROJECT_ID,
                name="Sample Products",
                description="Sample product data from DuckDB",
                table_name="products",
                schema_config=schema_config,
                row_count=10,
                file_name="sample.duckdb",
            )
            session.add(dataset)

        await session.commit()


async def close_db() -> None:
    """Close database connections."""
    await engine.dispose()
