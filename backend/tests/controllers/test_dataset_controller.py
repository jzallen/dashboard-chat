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
from app.repositories.upload_event_record import UploadEventRecord
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
        status='enabled',
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
                partition_fields=[],
                transforms=[],
            ),
            Dataset(
                id="dataset-001",
                project_id="project-001",
                storage_path="project-001/dataset-001.parquet",
                name="Dataset One",
                description=None,
                schema_config={"fields": {"col1": {"type": "text"}}},
                partition_fields=[],
                transforms=[
                    Transform(
                        id="transform-001",
                        name="Filter Active",
                        condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                        condition_sql="col1 = 'active'",
                        description="Filter for active records",
                        status='enabled',
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
            partition_fields=[],
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    status='enabled',
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


class TestUpdateDataset:
    """Tests for DatasetController.update_dataset workflow."""

    async def test_partial_update_changes_only_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with partial data should only change specified fields."""
        set_session(seeded_db)

        result = await DatasetController.update_dataset(
            dataset_id="dataset-001",
            name="Updated Dataset Name",
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            storage_path="project-001/dataset-001.parquet",
            name="Updated Dataset Name",
            description=None,
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    status='enabled',
                ),
            ],
        )

        match result:
            case Success(dataset):
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_full_update_changes_all_specified_fields(self, seeded_db: AsyncSession):
        """update_dataset with multiple fields should update all specified fields."""
        set_session(seeded_db)

        result = await DatasetController.update_dataset(
            dataset_id="dataset-001",
            name="Fully Updated Dataset",
            description="New description",
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            storage_path="project-001/dataset-001.parquet",
            name="Fully Updated Dataset",
            description="New description",
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[
                Transform(
                    id="transform-001",
                    name="Filter Active",
                    condition_json=QueryBuilderJSON.from_dict({"id": "root", "type": "group", "children1": []}),
                    condition_sql="col1 = 'active'",
                    description="Filter for active records",
                    status='enabled',
                ),
            ],
        )

        match result:
            case Success(dataset):
                assert dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when dataset not found."""
        set_session(seeded_db)

        result = await DatasetController.update_dataset(
            dataset_id="nonexistent",
            name="New Name",
        )

        match result:
            case Failure(error):
                assert error == "Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("update_dataset should fail when dataset does not exist")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

        from sqlalchemy.exc import SQLAlchemyError

        class FailingMetadataRepository:
            async def dataset_exists(self, dataset_id: str) -> bool:
                raise SQLAlchemyError("Database connection lost")

        result = await DatasetController.update_dataset(
            dataset_id="dataset-001",
            repositories={'metadata_repository': FailingMetadataRepository},
            name="New Name",
        )

        match result:
            case Failure(error):
                assert "Metadata repository error:" in error
            case Success(_):
                pytest.fail("update_dataset should fail when database error occurs")

    async def test_transform_marked_for_deletion_is_removed(self, seeded_db: AsyncSession):
        """update_dataset should delete transforms with status='deleted'."""
        set_session(seeded_db)

        # Get initial state - transform should exist with status='enabled'
        initial_result = await DatasetController.get_dataset(dataset_id="dataset-001")
        match initial_result:
            case Success(initial_dataset):
                assert len(initial_dataset.transforms) == 1
                assert initial_dataset.transforms[0].status == 'enabled'
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

        # Update with transform marked for deletion
        update_result = await DatasetController.update_dataset(
            dataset_id="dataset-001",
            transforms=[
                {"id": "transform-001", "name": "Filter Active", "status": "deleted"},
            ],
        )

        expected = Dataset(
            id="dataset-001",
            project_id="project-001",
            storage_path="project-001/dataset-001.parquet",
            name="Dataset One",
            description=None,
            schema_config={"fields": {"col1": {"type": "text"}}},
            partition_fields=[],
            transforms=[],
        )

        match update_result:
            case Success(updated_dataset):
                assert updated_dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

        # Get again and verify matches update result
        final_result = await DatasetController.get_dataset(dataset_id="dataset-001")
        match final_result:
            case Success(final_dataset):
                assert final_dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

    async def test_transform_status_updated_to_disabled(self, seeded_db: AsyncSession):
        """update_dataset should update transform status to disabled."""
        from dataclasses import asdict, replace
        set_session(seeded_db)

        # Get initial state - transform should be enabled
        initial_result = await DatasetController.get_dataset(dataset_id="dataset-001")
        match initial_result:
            case Success(initial_dataset):
                assert len(initial_dataset.transforms) == 1
                assert initial_dataset.transforms[0].status == 'enabled'
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")

        # Build expected state with transform status changed to disabled
        expected = replace(initial_dataset, transforms=[
            replace(initial_dataset.transforms[0], status='disabled')
        ])

        # Serialize and call update_dataset
        updated = asdict(expected)
        update_result = await DatasetController.update_dataset(
            dataset_id=updated.pop('id'),
            **updated,
        )

        match update_result:
            case Success(updated_dataset):
                assert updated_dataset == expected
            case Failure(error):
                pytest.fail(f"update_dataset should succeed, got: {error}")

        # Get again and verify matches update result
        final_result = await DatasetController.get_dataset(dataset_id="dataset-001")
        match final_result:
            case Success(final_dataset):
                assert final_dataset == expected
            case Failure(error):
                pytest.fail(f"get_dataset should succeed, got: {error}")


# =============================================================================
# Upload Flow Tests
# =============================================================================

class MockLakeRepository:
    """Mock lake repository for testing upload operations."""

    def __init__(self):
        self.stored_files: dict[str, bytes] = {}

    def write_raw_file(self, content: bytes, storage_path: str) -> str:
        self.stored_files[storage_path] = content
        return f"s3://test-bucket/{storage_path}"

    def read_raw_file(self, storage_path: str) -> bytes:
        return self.stored_files.get(storage_path, b"")

    def write_csv_as_partitioned_parquet(
        self,
        csv_content: bytes,
        storage_prefix: str,
        partition_fields: list[str],
    ) -> str:
        self.stored_files[storage_prefix] = csv_content
        return f"s3://test-bucket/{storage_prefix}"

    def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict]:
        return [{"col1": "value1"}, {"col1": "value2"}]


class TestUploadFile:
    """Tests for DatasetController.upload_file workflow."""

    @pytest.fixture
    def sample_csv(self) -> bytes:
        """Sample CSV content for testing."""
        return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"

    async def test_upload_file_creates_upload_event(self, seeded_db: AsyncSession, sample_csv: bytes):
        """upload_file should create UploadEvent."""
        set_session(seeded_db)

        from app.models import UploadEvent
        from app.use_cases import upload as upload_use_cases

        result = await upload_use_cases.upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="project-001",
            repositories={'lake_repository': MockLakeRepository},
        )

        expected = UploadEvent(
            id=result.id,
            project_id="project-001",
            dataset_id=None,
            status="pending",
            raw_storage_path=f"uploads/project-001/{result.id}.csv",
            original_filename="test_data.csv",
            file_size=len(sample_csv),
            row_count=3,
            created_at=result.created_at,
            preview_rows=[
                {"name": "Alice", "age": 30, "active": True},
                {"name": "Bob", "age": 25, "active": False},
                {"name": "Charlie", "age": 35, "active": True},
            ],
        )
        assert result == expected

    async def test_upload_file_with_dataset_id_sets_dataset_id(self, seeded_db: AsyncSession, sample_csv: bytes):
        """upload_file with dataset_id should set dataset_id on UploadEvent."""
        set_session(seeded_db)

        from app.models import UploadEvent
        from app.use_cases import upload as upload_use_cases

        result = await upload_use_cases.upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="project-001",
            dataset_id="dataset-001",
            repositories={'lake_repository': MockLakeRepository},
        )

        expected = UploadEvent(
            id=result.id,
            project_id="project-001",
            dataset_id="dataset-001",
            status="pending",
            raw_storage_path=f"uploads/project-001/{result.id}.csv",
            original_filename="test_data.csv",
            file_size=len(sample_csv),
            row_count=3,
            created_at=result.created_at,
            preview_rows=[
                {"name": "Alice", "age": 30, "active": True},
                {"name": "Bob", "age": 25, "active": False},
                {"name": "Charlie", "age": 35, "active": True},
            ],
        )
        assert result == expected

    async def test_upload_file_rejects_non_csv(self, seeded_db: AsyncSession):
        """upload_file should reject non-CSV files."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=b"some content",
            file_name="data.xlsx",
            project_id="project-001",
        )

        match result:
            case Failure(error):
                assert "Only CSV files are supported" in error
            case Success(_):
                pytest.fail("upload_file should reject non-CSV files")

    async def test_upload_file_rejects_empty_file(self, seeded_db: AsyncSession):
        """upload_file should reject empty files."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=b"",
            file_name="empty.csv",
            project_id="project-001",
        )

        match result:
            case Failure(error):
                assert "File is empty" in error
            case Success(_):
                pytest.fail("upload_file should reject empty files")

    async def test_upload_file_rejects_nonexistent_project(self, seeded_db: AsyncSession, sample_csv: bytes):
        """upload_file should fail when project doesn't exist."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=sample_csv,
            file_name="test.csv",
            project_id="nonexistent-project",
        )

        match result:
            case Failure(error):
                assert "not found" in error.lower()
            case Success(_):
                pytest.fail("upload_file should fail for nonexistent project")

    async def test_upload_file_rejects_nonexistent_dataset(self, seeded_db: AsyncSession, sample_csv: bytes):
        """upload_file should fail when dataset_id doesn't exist."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=sample_csv,
            file_name="test.csv",
            project_id="project-001",
            dataset_id="nonexistent-dataset",
        )

        match result:
            case Failure(error):
                assert "not found" in error.lower()
            case Success(_):
                pytest.fail("upload_file should fail for nonexistent dataset")


class TestGetUpload:
    """Tests for DatasetController.get_upload workflow."""

    @pytest.fixture
    async def seeded_upload(self, seeded_db: AsyncSession) -> str:
        """Seed database with an upload event."""
        upload = UploadEventRecord(
            id="upload-001",
            project_id="project-001",
            dataset_id=None,
            status="pending",
            raw_storage_path="uploads/project-001/upload-001.csv",
            original_filename="test_data.csv",
            file_size=100,
            row_count=10,
        )
        seeded_db.add(upload)
        await seeded_db.commit()
        return "upload-001"

    async def test_get_upload_returns_upload_event(self, seeded_db: AsyncSession, seeded_upload: str):
        """get_upload should return UploadEvent for valid ID."""
        set_session(seeded_db)

        result = await DatasetController.get_upload(upload_id=seeded_upload)

        match result:
            case Success(upload_event):
                assert upload_event["id"] == "upload-001"
                assert upload_event["project_id"] == "project-001"
                assert upload_event["status"] == "pending"
                assert upload_event["original_filename"] == "test_data.csv"
            case Failure(error):
                pytest.fail(f"get_upload should succeed, got: {error}")

    async def test_get_upload_returns_failure_for_invalid_id(self, seeded_db: AsyncSession):
        """get_upload should return Failure for nonexistent upload."""
        set_session(seeded_db)

        result = await DatasetController.get_upload(upload_id="nonexistent")

        match result:
            case Failure(error):
                assert "not found" in error.lower()
            case Success(_):
                pytest.fail("get_upload should fail for nonexistent upload")


class TestListUploads:
    """Tests for DatasetController.list_uploads workflow."""

    @pytest.fixture
    async def seeded_uploads(self, seeded_db: AsyncSession) -> None:
        """Seed database with multiple upload events."""
        upload1 = UploadEventRecord(
            id="upload-001",
            project_id="project-001",
            dataset_id=None,
            status="pending",
            raw_storage_path="uploads/project-001/upload-001.csv",
            original_filename="file1.csv",
            file_size=100,
            row_count=10,
        )
        upload2 = UploadEventRecord(
            id="upload-002",
            project_id="project-001",
            dataset_id="dataset-001",
            status="completed",
            raw_storage_path="uploads/project-001/upload-002.csv",
            original_filename="file2.csv",
            file_size=200,
            row_count=20,
        )
        seeded_db.add(upload1)
        seeded_db.add(upload2)
        await seeded_db.commit()

    async def test_list_uploads_returns_all_uploads(self, seeded_db: AsyncSession, seeded_uploads: None):
        """list_uploads should return all upload events."""
        set_session(seeded_db)

        result = await DatasetController.list_uploads()

        match result:
            case Success(uploads):
                assert len(uploads) == 2
            case Failure(error):
                pytest.fail(f"list_uploads should succeed, got: {error}")

    async def test_list_uploads_filters_by_project_id(self, seeded_db: AsyncSession, seeded_uploads: None):
        """list_uploads should filter by project_id."""
        set_session(seeded_db)

        # Add upload to different project
        project2 = ProjectRecord(id="project-002", name="Project Two")
        seeded_db.add(project2)
        upload3 = UploadEventRecord(
            id="upload-003",
            project_id="project-002",
            raw_storage_path="uploads/project-002/upload-003.csv",
            original_filename="file3.csv",
            file_size=300,
            row_count=30,
        )
        seeded_db.add(upload3)
        await seeded_db.commit()

        result = await DatasetController.list_uploads(project_id="project-001")

        match result:
            case Success(uploads):
                assert len(uploads) == 2
                assert all(u["project_id"] == "project-001" for u in uploads)
            case Failure(error):
                pytest.fail(f"list_uploads should succeed, got: {error}")

    async def test_list_uploads_filters_by_dataset_id(self, seeded_db: AsyncSession, seeded_uploads: None):
        """list_uploads should filter by dataset_id."""
        set_session(seeded_db)

        result = await DatasetController.list_uploads(dataset_id="dataset-001")

        match result:
            case Success(uploads):
                assert len(uploads) == 1
                assert uploads[0]["dataset_id"] == "dataset-001"
            case Failure(error):
                pytest.fail(f"list_uploads should succeed, got: {error}")


class TestCreateDatasetFromUpload:
    """Tests for DatasetController.create_dataset_from_upload workflow."""

    @pytest.fixture
    async def pending_upload(self, seeded_db: AsyncSession) -> str:
        """Seed database with a pending upload event."""
        upload = UploadEventRecord(
            id="upload-pending",
            project_id="project-001",
            dataset_id=None,
            status="pending",
            raw_storage_path="uploads/project-001/upload-pending.csv",
            original_filename="test_data.csv",
            file_size=100,
            row_count=10,
        )
        seeded_db.add(upload)
        await seeded_db.commit()
        return "upload-pending"

    async def test_create_dataset_from_upload_creates_dataset(
        self, seeded_db: AsyncSession, pending_upload: str
    ):
        """create_dataset_from_upload should create dataset with correct properties."""
        set_session(seeded_db)

        from app.use_cases import upload as upload_use_cases

        mock_lake = MockLakeRepository()
        mock_lake.stored_files["uploads/project-001/upload-pending.csv"] = b"name,age\nAlice,30"

        result = await upload_use_cases.create_dataset_from_upload(
            upload_id=pending_upload,
            project_id="project-001",
            name="New Dataset",
            partition_fields=["name"],
            description="Test dataset",
            repositories={'lake_repository': lambda: mock_lake},
        )

        assert result["name"] == "New Dataset"
        assert result["description"] == "Test dataset"
        assert result["project_id"] == "project-001"
        assert result["partition_fields"] == ["name"]
        assert "fields" in result["schema_config"]
        assert "name" in result["schema_config"]["fields"]
        assert "age" in result["schema_config"]["fields"]
        assert result["row_count"] == 10
        assert result["upload_id"] == pending_upload
        assert "id" in result
        assert result["storage_path"].startswith("datasets/project-001/")

    async def test_create_dataset_from_upload_updates_upload_status(
        self, seeded_db: AsyncSession, pending_upload: str
    ):
        """create_dataset_from_upload should update upload status to completed."""
        set_session(seeded_db)

        from app.use_cases import upload as upload_use_cases

        mock_lake = MockLakeRepository()
        mock_lake.stored_files["uploads/project-001/upload-pending.csv"] = b"name,age\nAlice,30"

        await upload_use_cases.create_dataset_from_upload(
            upload_id=pending_upload,
            project_id="project-001",
            name="New Dataset",
            repositories={'lake_repository': lambda: mock_lake},
        )

        # Check upload status was updated
        get_result = await DatasetController.get_upload(upload_id=pending_upload)
        match get_result:
            case Success(upload):
                assert upload["status"] == "completed"
                assert upload["dataset_id"] is not None
            case Failure(error):
                pytest.fail(f"get_upload should succeed, got: {error}")

    async def test_create_dataset_from_upload_fails_for_nonexistent_upload(self, seeded_db: AsyncSession):
        """create_dataset_from_upload should fail for nonexistent upload."""
        set_session(seeded_db)

        result = await DatasetController.create_dataset_from_upload(
            upload_id="nonexistent",
            project_id="project-001",
            name="New Dataset",
        )

        match result:
            case Failure(error):
                assert "not found" in error.lower()
            case Success(_):
                pytest.fail("create_dataset_from_upload should fail for nonexistent upload")

    async def test_create_dataset_from_upload_fails_for_already_processed(
        self, seeded_db: AsyncSession
    ):
        """create_dataset_from_upload should fail if upload already processed."""
        set_session(seeded_db)

        upload = UploadEventRecord(
            id="upload-completed",
            project_id="project-001",
            dataset_id="dataset-001",
            status="completed",
            raw_storage_path="uploads/project-001/upload-completed.csv",
            original_filename="test.csv",
            file_size=100,
            row_count=10,
        )
        seeded_db.add(upload)
        await seeded_db.commit()

        result = await DatasetController.create_dataset_from_upload(
            upload_id="upload-completed",
            project_id="project-001",
            name="New Dataset",
        )

        match result:
            case Failure(error):
                assert "already" in error.lower()
            case Success(_):
                pytest.fail("create_dataset_from_upload should fail for already processed upload")

    async def test_create_dataset_from_upload_fails_for_project_mismatch(
        self, seeded_db: AsyncSession, pending_upload: str
    ):
        """create_dataset_from_upload should fail if project_id doesn't match."""
        set_session(seeded_db)

        # Create another project
        project2 = ProjectRecord(id="project-002", name="Project Two")
        seeded_db.add(project2)
        await seeded_db.commit()

        result = await DatasetController.create_dataset_from_upload(
            upload_id=pending_upload,
            project_id="project-002",  # Wrong project
            name="New Dataset",
        )

        match result:
            case Failure(error):
                assert "mismatch" in error.lower()
            case Success(_):
                pytest.fail("create_dataset_from_upload should fail for project mismatch")
