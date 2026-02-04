"""Integration tests for DatasetController.

These tests verify controller behavior against a real database.
Run with: pytest backend/tests/controllers/test_dataset_controller.py
"""

import io
import tempfile
import boto3
from botocore.stub import Stubber

import pytest
from unittest.mock import Mock
from functools import partial
from dataclasses import asdict
from returns.result import Failure, Success
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.exc import SQLAlchemyError
from botocore.exceptions import ClientError


from app.controllers.dataset_controller import DatasetController
from app.database import Base
from app.repositories import set_session
from app.models.dataset import Dataset
from app.models.transform import Transform
from app.models.upload import Upload
from app.repositories.lake import MinIOLakeRepository
from app.repositories.metadata import DatasetRecord, ProjectRecord, TransformRecord
from app.repositories.outbox import OutboxRecord
from app.repositories.outbox.events import UploadFileReceived
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
            )
    dataset2 = DatasetRecord(
        id="dataset-002",
        storage_path="project-001/dataset-002.parquet",
        project_id="project-001",
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
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
                name="Dataset Two",
                description=None,
                schema_config={"fields": {"col2": {"type": "number"}}},
                partition_fields=[],
                transforms=[],
            ),
            Dataset(
                id="dataset-001",
                project_id="project-001",
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

        metadata_repository = Mock(side_effect=SQLAlchemyError("Database connection lost"))
        result = await DatasetController.list_datasets(
            project_id="project-001",
            repositories={'metadata_repository': metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Failed to list datasets: Database connection lost" in error
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
                assert error == "Failed to get dataset: Dataset with ID 'nonexistent' not found"
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


        class FailingMetadataRepository:
            async def get_dataset_record(self, dataset_id: str, include_transforms: bool = True):
                raise SQLAlchemyError("Connection lost")

        result = await DatasetController.get_dataset(
            dataset_id="dataset-001",
            repositories={'metadata_repository': FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert error == "Failed to get dataset: Connection lost"
            case Success(_):
                pytest.fail("get_dataset should fail when database error occurs")

    async def test_when_lake_error_returns_lake_repository_error(self, seeded_db: AsyncSession):
        """get_dataset should return LakeRepositoryError when storage fails."""
        set_session(seeded_db)

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
                assert error == "Failed to get dataset: An error occurred (NoSuchKey) when calling the GetObject operation: Key not found"
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
                assert error == "Failed to update dataset: Dataset with ID 'nonexistent' not found"
            case Success(_):
                pytest.fail("update_dataset should fail when dataset does not exist")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_dataset should return Failure when database error occurs."""
        set_session(seeded_db)

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
                assert error == "Failed to update dataset: Database connection lost"
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

@pytest.fixture
def sample_csv() -> bytes:
    """Sample CSV content for testing."""
    return b"name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true"


@pytest.fixture
def s3_stubber(sample_csv: bytes) -> Stubber:
    s3_stubber = Stubber(boto3.client("s3"))
    s3_stubber.add_response('put_object', {}, {
        'Bucket': 'dashboard-chat.datalake',
        'Key': 'uploads/project-001/test_data.csv',
        'ContentType': 'application/octet-stream',
        'Body': b'name,age,active\nAlice,30,true\nBob,25,false\nCharlie,35,true',
    })
    return s3_stubber

class TestUploadFile:
    """Tests for DatasetController.upload_file workflow."""


    async def test_upload_file_creates_upload_event(self, seeded_db: AsyncSession, s3_stubber: Stubber, sample_csv: bytes):
        """upload_file should create Upload."""
        set_session(seeded_db)

        with s3_stubber:
            repositories = {
                'lake_repository': partial(MinIOLakeRepository,s3_client=s3_stubber.client),
            }
            result = await DatasetController.upload_file(
                file_content=sample_csv,
                file_name="test_data.csv",
                project_id="project-001",
                repositories=repositories,
            )

        match result:
            case Failure(error):
                pytest.fail(f"upload_file should succeed, got: {error}")
            case Success(result):

                expected = Upload(
                    id=result.id,
                    project_id="project-001",
                    dataset_id=None,
                    status="pending",
                    raw_storage_path=f"uploads/project-001/test_data.csv",
                    original_filename="test_data.csv",
                    file_size=len(sample_csv),
                    created_at=result.created_at,
                    preview_rows=[
                        {"name": "Alice", "age": 30, "active": True},
                        {"name": "Bob", "age": 25, "active": False},
                        {"name": "Charlie", "age": 35, "active": True},
                    ],
                )
                assert result == expected

    async def test_upload_file_with_dataset_id_sets_dataset_id(self, seeded_db: AsyncSession, s3_stubber: Stubber, sample_csv: bytes):
        """upload_file with dataset_id should set dataset_id on Upload."""
        set_session(seeded_db)


        result = await DatasetController.upload_file(
            file_content=sample_csv,
            file_name="test_data.csv",
            project_id="project-001",
            dataset_id="dataset-001",
            repositories={'lake_repository': partial(MinIOLakeRepository, s3_client=s3_stubber.client)},
        )

        match result:
            case Failure(error):
                pytest.fail(f"upload_file should succeed, got: {error}")
            case Success(result):

                expected = Upload(
                    id=result.id,
                    project_id="project-001",
                    dataset_id="dataset-001",
                    status="pending",
                    raw_storage_path=f"uploads/project-001/test_data.csv",
                    original_filename="test_data.csv",
                    file_size=len(sample_csv),
                    created_at=result.created_at,
                    preview_rows=[
                        {"name": "Alice", "age": 30, "active": True},
                        {"name": "Bob", "age": 25, "active": False},
                        {"name": "Charlie", "age": 35, "active": True},
                    ],
                )
                assert result == expected

    async def test_upload_file_rejects_non_csv(self, seeded_db: AsyncSession, s3_stubber: Stubber):
        """upload_file should reject non-CSV files."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=b"some content",
            file_name="data.xlsx",
            project_id="project-001",
            repositories={'lake_repository': partial(MinIOLakeRepository, s3_client=s3_stubber.client)},
        )

        match result:
            case Failure(error):
                assert "Only CSV files are supported" in error
            case Success(_):
                pytest.fail("upload_file should reject non-CSV files")

    async def test_upload_file_rejects_empty_file(self, s3_stubber: Stubber, seeded_db: AsyncSession):
        """upload_file should reject empty files."""
        set_session(seeded_db)

        result = await DatasetController.upload_file(
            file_content=b"",
            file_name="empty.csv",
            project_id="project-001",
            repositories={'lake_repository': partial(MinIOLakeRepository, s3_client=s3_stubber.client)},
        )

        match result:
            case Failure(error):
                assert "File is empty" in error
            case Success(_):
                pytest.fail("upload_file should reject empty files")

    async def test_upload_file_rejects_nonexistent_project(self, seeded_db: AsyncSession, s3_stubber: Stubber, sample_csv: bytes):
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

    async def test_upload_file_rejects_nonexistent_dataset(self, seeded_db: AsyncSession, s3_stubber: Stubber, sample_csv: bytes):
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

@pytest.fixture
def s3_read_write_stubber(sample_csv: bytes) -> Stubber:
    """Stubber for S3 read/write operations used by create-from-upload flow."""
    stubber = Stubber(boto3.client("s3"))
    stubber.add_response('get_object', {
        'Body': io.BytesIO(sample_csv),
    }, {
        'Bucket': 'dashboard-chat.datalake',
        'Key': 'uploads/project-001/test_data.csv',
    })
    # One put_object per partition value (age: 25, 30, 35)
    for _ in range(3):
        stubber.add_response('put_object', {})
    return stubber

class TestCreateDatasetFromUpload:
    """Tests for DatasetController.create_dataset_from_upload workflow."""

    async def test_create_dataset_from_valid_upload(self, seeded_db: AsyncSession, s3_read_write_stubber: Stubber, sample_csv: bytes):
        """create_dataset_from_upload should create Dataset from valid Upload."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-001",
                aggregate_id="project-001",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(UploadFileReceived(
                    project_id="project-001",
                    dataset_id=None,
                    raw_storage_path="uploads/project-001/test_data.csv",
                    original_filename="test_data.csv",
                    file_size=len(sample_csv),
                )),
            )
        )
        await seeded_db.commit()

        with s3_read_write_stubber:
            result = await DatasetController.create_dataset_from_upload(
                upload_id="upload-001",
                name="test_data",
                partition_fields=['age'],
                description=None,
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=s3_read_write_stubber.client),
                },
            )
        match result:
            case Failure(error):
                pytest.fail(f"create_dataset_from_upload should succeed, got: {error}")
            case Success(dataset):
                expected = Dataset(
                    id=dataset.id,
                    project_id="project-001",
                    name="test_data",
                    description=None,
                    schema_config={
                        "fields": {
                            "name": {"type": "text"},
                            "age": {"type": "number"},
                            "active": {"type": "boolean"},
                        }
                    },
                    partition_fields=['age'],
                    transforms=[],
                    preview_rows=[
                        {"name": "Alice", "age": 30, "active": True},
                        {"name": "Bob", "age": 25, "active": False},
                        {"name": "Charlie", "age": 35, "active": True},
                    ],
                )
                assert dataset == expected

    async def test_create_dataset_from_nonexistent_upload(self, seeded_db: AsyncSession):
        """create_dataset_from_upload should fail when upload_id doesn't exist."""
        set_session(seeded_db)

        result = await DatasetController.create_dataset_from_upload(
            upload_id="nonexistent-upload",
            name="test_data",
            partition_fields=[],
            description=None,
        )
        assert result == Failure("Upload with ID 'nonexistent-upload' not found")

    async def test_create_dataset_from_upload_with_nonexistent_project(self, seeded_db: AsyncSession, sample_csv: bytes):
        """create_dataset_from_upload should fail when project doesn't exist."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-orphan",
                aggregate_id="project-gone",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(UploadFileReceived(
                    project_id="project-gone",
                    dataset_id=None,
                    raw_storage_path="uploads/project-gone/test_data.csv",
                    original_filename="test_data.csv",
                    file_size=len(sample_csv),
                )),
            )
        )
        await seeded_db.commit()

        result = await DatasetController.create_dataset_from_upload(
            upload_id="upload-orphan",
            name="test_data",
            partition_fields=[],
            description=None,
        )
        assert result == Failure("Failed to create dataset: Project with ID 'project-gone' not found")

    async def test_create_dataset_from_already_processed_upload(self, seeded_db: AsyncSession, s3_read_write_stubber: Stubber, sample_csv: bytes):
        """Second call to create_dataset_from_upload should fail — upload already processed."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-002",
                aggregate_id="project-001",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(UploadFileReceived(
                    project_id="project-001",
                    dataset_id=None,
                    raw_storage_path="uploads/project-001/test_data.csv",
                    original_filename="test_data.csv",
                    file_size=len(sample_csv),
                )),
            )
        )
        await seeded_db.commit()

        # First call succeeds
        with s3_read_write_stubber:
            first = await DatasetController.create_dataset_from_upload(
                upload_id="upload-002",
                name="test_data",
                partition_fields=['age'],
                description=None,
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=s3_read_write_stubber.client),
                },
            )
        assert isinstance(first, Success)

        # Second call fails before reaching S3 — upload already processed
        second = await DatasetController.create_dataset_from_upload(
            upload_id="upload-002",
            name="test_data",
            partition_fields=['age'],
            description=None,
        )
        assert second == Failure("Failed to create dataset: [OutboxRepository] Event upload-002 has already been processed")

    async def test_create_dataset_from_upload_with_missing_file(self, seeded_db: AsyncSession, sample_csv: bytes):
        """create_dataset_from_upload should fail when raw file is missing from S3."""
        set_session(seeded_db)

        seeded_db.add(
            OutboxRecord(
                id="upload-003",
                aggregate_id="project-001",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(UploadFileReceived(
                    project_id="project-001",
                    dataset_id=None,
                    raw_storage_path="uploads/project-001/gone.csv",
                    original_filename="gone.csv",
                    file_size=len(sample_csv),
                )),
            )
        )
        await seeded_db.commit()

        empty_stubber = Stubber(boto3.client("s3"))
        empty_stubber.add_response('get_object', {
            'Body': io.BytesIO(b''),
        }, {
            'Bucket': 'dashboard-chat.datalake',
            'Key': 'uploads/project-001/gone.csv',
        })

        with empty_stubber:
            result = await DatasetController.create_dataset_from_upload(
                upload_id="upload-003",
                name="test_data",
                partition_fields=[],
                description=None,
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=empty_stubber.client),
                },
            )
        assert result == Failure("Upload with ID 'upload-003' not found")

    async def test_create_dataset_from_upload_with_invalid_csv(self, seeded_db: AsyncSession):
        """create_dataset_from_upload should fail when file content is not valid CSV."""
        set_session(seeded_db)

        bad_content = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'

        seeded_db.add(
            OutboxRecord(
                id="upload-004",
                aggregate_id="project-001",
                aggregate_type="project",
                event_type="UploadFileReceived",
                payload=asdict(UploadFileReceived(
                    project_id="project-001",
                    dataset_id=None,
                    raw_storage_path="uploads/project-001/bad.csv",
                    original_filename="bad.csv",
                    file_size=len(bad_content),
                )),
            )
        )
        await seeded_db.commit()

        stubber = Stubber(boto3.client("s3"))
        stubber.add_response('get_object', {
            'Body': io.BytesIO(bad_content),
        }, {
            'Bucket': 'dashboard-chat.datalake',
            'Key': 'uploads/project-001/bad.csv',
        })

        with stubber:
            result = await DatasetController.create_dataset_from_upload(
                upload_id="upload-004",
                name="bad_data",
                partition_fields=[],
                description=None,
                repositories={
                    'lake_repository': partial(MinIOLakeRepository, s3_client=stubber.client),
                },
            )
        assert isinstance(result, Failure)
