"""Integration tests for DatasetController.

These tests verify controller behavior against a real database.
Run with: pytest backend/tests/controllers/test_dataset_controller.py
"""

import tempfile

import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.exceptions import MetadataRepositoryError
from app.controllers.dataset_controller import DatasetController
from app.database import Base
from app.db_context import set_session
from app.models.dataset import Dataset
from app.models.project import Project
from app.repositories.dataset_record import DatasetRecord


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
    """Seed the database with a project and two datasets."""
    project = Project(
        id="project-001",
        name="Test Project",
    )
    db_session.add(project)

    dataset1 = DatasetRecord(
        id="dataset-001",
        storage_path="project-001/dataset-001.parquet",
        project_id="project-001",
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
        row_count=100,
    )
    dataset2 = DatasetRecord(
        id="dataset-002",
        storage_path="project-001/dataset-002.parquet",
        project_id="project-001",
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
        row_count=200,
    )
    db_session.add(dataset1)
    db_session.add(dataset2)

    await db_session.commit()

    return db_session


class TestListDatasets:
    """Tests for DatasetController.list_datasets workflow."""

    async def test_given_project_id_returns_list_of_dataset(self, db_session: AsyncSession, seeded_db):
        """list_datasets should return Result containing list[Dataset]."""
        set_session(db_session)

        expected = [
            Dataset(
                id="dataset-002",
                storage_path="project-001/dataset-002.parquet",
                name="Dataset Two",
                schema_config={"fields": {"col2": {"type": "number"}}},
                transforms=[],
            ),
            Dataset(
                id="dataset-001",
                storage_path="project-001/dataset-001.parquet",
                name="Dataset One",
                schema_config={"fields": {"col1": {"type": "text"}}},
                transforms=[],
            ),
        ]

        result = await DatasetController.list_datasets(project_id="project-001")

        match result:
            case Success(datasets):
                assert datasets == expected
            case Failure(error):
                pytest.fail(f"list_datasets should return datasets for valid project_id, got: {error}")

    async def test_given_no_project_id_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project_id is None."""
        set_session(db_session)

        result = await DatasetController.list_datasets(project_id=None)

        match result:
            case Failure(error):
                assert "project_id is required" in error
            case Success(_):
                pytest.fail("list_datasets should fail when project_id is None")

    async def test_when_two_projects_exist_returns_only_datasets_for_specified_project(self, db_session: AsyncSession, seeded_db):
        """list_datasets should return datasets only for the specified project."""
        set_session(db_session)

        # Arrange: Add a second project and dataset
        new_project = Project(
            id="project-002",
            name="Another Project",
        )
        db_session.add(new_project)

        new_dataset = DatasetRecord(
            id="dataset-003",
            storage_path="project-002/dataset-003.parquet",
            project_id="project-002",
            name="Dataset Three",
            schema_config={"fields": {"col3": {"type": "boolean"}}},
            row_count=150,
        )
        db_session.add(new_dataset)

        await db_session.commit()

        # Act
        result = await DatasetController.list_datasets(project_id="project-001")

        # Assert
        match result:
            case Success(datasets):
                assert new_dataset not in datasets
            case Failure(error):
                pytest.fail(f"list_datasets should filter by project_id, got: {error}")

    async def test_given_project_with_no_datasets_returns_empty_list(self, db_session: AsyncSession):
        """list_datasets should return empty list when project has no datasets."""
        set_session(db_session)

        project = Project(
            id="empty-project",
            name="Empty Project",
        )
        db_session.add(project)
        await db_session.commit()

        result = await DatasetController.list_datasets(project_id="empty-project")

        match result:
            case Success(datasets):
                assert datasets == []
            case Failure(error):
                pytest.fail(f"list_datasets should return empty list for project with no datasets, got: {error}")

    async def test_when_project_does_not_exist_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project does not exist."""
        set_session(db_session)

        result = await DatasetController.list_datasets(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in error
            case Success(_):
                pytest.fail("list_datasets should fail when project does not exist")

    async def test_when_database_error_occurs_returns_failure(self, db_session: AsyncSession, seeded_db):
        """list_datasets should return Failure when a database error occurs."""
        set_session(db_session)

        # Simulate a database error by closing the session
        await db_session.close()

        use_case_with_side_effect = Mock(side_effect=MetadataRepositoryError("Database connection lost"))
        result = await DatasetController.list_datasets(
            project_id="project-001", 
            list_datasets_func=use_case_with_side_effect
        )

        match result:
            case Failure(error):
                assert "Metadata repository error: Database connection lost" in error
            case Success(_):
                pytest.fail("list_datasets should fail when database error occurs")
