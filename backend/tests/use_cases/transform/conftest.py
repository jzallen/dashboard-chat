import pytest
import tempfile
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import event
from app.database import Base
from app.repositories.metadata import TransformRecord, DatasetRecord, ProjectRecord
from app.repositories.outbox.outbox_record import OutboxRecord


@pytest.fixture
async def db_session():
    """Create a temporary SQLite database and session for testing."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
    )

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
    """Seed the database with a project, dataset, and transforms."""
    project = ProjectRecord(
        id="project-001",
        name="Test Project",
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)

    transform = TransformRecord(
        id="transform-001",
        dataset_id="dataset-001",
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        status='enabled',
    )
    db_session.add(transform)

    transform2 = TransformRecord(
        id="transform-002",
        dataset_id="dataset-001",
        name="Filter Inactive",
        description="Filter for inactive records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'inactive'",
        status='enabled',
    )
    db_session.add(transform2)

    await db_session.commit()

    return db_session
