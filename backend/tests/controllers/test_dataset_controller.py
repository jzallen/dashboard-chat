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
from app.repositories import set_session
from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories.dataset_record import DatasetRecord
from app.repositories.project_record import ProjectRecord
from app.repositories.transform_record import TransformRecord
from app.types import QueryBuilderJSON


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
    """Seed the database with a project, two datasets, and a transform."""
    project = ProjectRecord(
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

    transform1 = TransformRecord(
        id="transform-001",
        dataset_id="dataset-001",
        name="Filter Active",
        description="Filter for active records",
        condition_json={"id": "root", "type": "group", "children1": []},
        condition_sql="col1 = 'active'",
        is_active=True,
    )
    db_session.add(transform1)

    await db_session.commit()

    return db_session


class TestListDatasets:
    """Tests for DatasetController.list_datasets workflow."""

    async def test_given_project_id_returns_list_of_dataset(self, seeded_db: AsyncSession):
        """list_datasets should return Result containing list[Dataset]."""
        set_session(seeded_db)

        expected = [
            Dataset(
                id="dataset-002",
                project_id="project-001",
                storage_path="project-001/dataset-002.parquet",
                name="Dataset Two",
                description=None,
                schema_config={"fields": {"col2": {"type": "number"}}},
                transforms=[],
            ),
            Dataset(
                id="dataset-001",
                project_id="project-001",
                storage_path="project-001/dataset-001.parquet",
                name="Dataset One",
                description=None,
                schema_config={"fields": {"col1": {"type": "text"}}},
                transforms=[
                    Transform(
                        id="transform-001",
                        name="Filter Active",
                        condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                        condition_sql="col1 = 'active'",
                        description="Filter for active records",
                        is_active=True,
                    ),
                ],
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

    async def test_when_two_projects_exist_returns_only_datasets_for_specified_project(self, seeded_db: AsyncSession):
        """list_datasets should return datasets only for the specified project."""
        set_session(seeded_db)

        # Arrange: Add a second project and dataset
        new_project = ProjectRecord(
            id="project-002",
            name="Another Project",
        )
        seeded_db.add(new_project)

        new_dataset = DatasetRecord(
            id="dataset-003",
            storage_path="project-002/dataset-003.parquet",
            project_id="project-002",
            name="Dataset Three",
            schema_config={"fields": {"col3": {"type": "boolean"}}},
            row_count=150,
        )
        seeded_db.add(new_dataset)

        await seeded_db.commit()

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

        project = ProjectRecord(
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

    async def test_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """list_datasets should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Simulate a database error by closing the session
        await seeded_db.close()

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


class TestGetDataset:
    """Tests for DatasetController.get_dataset workflow."""

    async def test_given_valid_id_returns_dataset_with_transforms(self, seeded_db: AsyncSession):
        """get_dataset should return Dataset with transforms by default."""
        set_session(seeded_db)

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            storage_path="project-001/dataset-001.parquet",
            name="Dataset One",
            description=None,
            schema_config={"fields": {"col1": {"type": "text"}}},
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    is_active=True,
                ),
            ],
            preview_rows=[],
        )

        result = await DatasetController.get_dataset(dataset_id="dataset-001")

        match result:
            case Success(dataset):
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should return dataset for valid id, got: {error}")

    async def test_with_include_transforms_false_returns_empty_transforms(self, seeded_db: AsyncSession):
        """get_dataset with include_transforms=False should return empty transforms list."""
        set_session(seeded_db)

        result = await DatasetController.get_dataset(
            dataset_id="dataset-001",
            include_transforms=False,
        )

        match result:
            case Success(dataset):
                assert dataset.transforms == []
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """get_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await DatasetController.get_dataset(dataset_id="nonexistent")

        match result:
            case Failure(error):
                assert error == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("get_dataset should fail when dataset does not exist")

    async def test_with_include_preview_returns_preview_rows(self, seeded_db: AsyncSession):
        """get_dataset with include_preview should populate preview_rows."""
        set_session(seeded_db)

        mock_preview = [{"col1": "value1"}, {"col1": "value2"}]

        class MockLakeRepository:
            def read_parquet_preview(self, storage_path: str, limit: int = 10):
                return mock_preview

        result = await DatasetController.get_dataset(
            dataset_id="dataset-001",
            include_preview=True,
            preview_limit=5,
            repositories={'lake_repository': MockLakeRepository},
        )

        match result:
            case Success(dataset):
                assert isinstance(dataset, Dataset)
                assert dataset.preview_rows == mock_preview
            case Failure(error):
                pytest.fail(f"get_dataset with preview should succeed, got: {error}")

    async def test_when_database_error_returns_metadata_repository_error(self, seeded_db: AsyncSession):
        """get_dataset should return MetadataRepositoryError when database fails."""
        set_session(seeded_db)

        from sqlalchemy.exc import SQLAlchemyError

        class FailingMetadataRepository:
            async def get_dataset_record(self, dataset_id: str, include_transforms: bool = True):
                raise SQLAlchemyError("Connection lost")

        result = await DatasetController.get_dataset(
            dataset_id="dataset-001",
            repositories={'metadata_repository': FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert error.startswith("Metadata repository error:")
            case Success(_):
                pytest.fail("get_dataset should fail when database error occurs")

    async def test_when_lake_error_returns_lake_repository_error(self, seeded_db: AsyncSession):
        """get_dataset should return LakeRepositoryError when storage fails."""
        set_session(seeded_db)

        from botocore.exceptions import ClientError

        class FailingLakeRepository:
            def read_parquet_preview(self, storage_path: str, limit: int = 10):
                raise ClientError(
                    {"Error": {"Code": "NoSuchKey", "Message": "Key not found"}},
                    "GetObject"
                )

        result = await DatasetController.get_dataset(
            dataset_id="dataset-001",
            include_preview=True,
            repositories={'lake_repository': FailingLakeRepository},
        )

        match result:
            case Failure(error):
                assert error.startswith("Lake repository error:")
            case Success(_):
                pytest.fail("get_dataset should fail when lake error occurs")
