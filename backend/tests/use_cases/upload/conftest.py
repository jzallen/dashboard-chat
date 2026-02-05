
import pytest
import tempfile
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import event
from app.database import Base
from app.repositories.metadata import DatasetRecord, ProjectRecord


@pytest.fixture
async def db_session():
    """Create a temporary SQLite database and session for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
    )

    # Enable foreign keys for SQLite
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session_factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with a project and dataset for upload tests."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Existing Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    await db_session.commit()

    return db_session
