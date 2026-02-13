import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError


from app.use_cases.dataset import list_datasets
from app.repositories import set_session
from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.types import QueryBuilderJSON



class TestListDatasets:
    """Tests for list_datasets workflow."""

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

        result = await list_datasets(project_id="project-001")

        match result:
            case Success(datasets):
                assert datasets == expected
            case Failure(error):
                pytest.fail(f"list_datasets should return datasets for valid project_id, got: {error}")

    async def test_given_no_project_id_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project_id is None."""
        set_session(db_session)

        result = await list_datasets(project_id=None)

        match result:
            case Failure(error):
                assert "project_id is required" in str(error)
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
        result = await list_datasets(project_id="project-001")

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

        result = await list_datasets(project_id="empty-project")

        match result:
            case Success(datasets):
                assert datasets == []
            case Failure(error):
                pytest.fail(f"list_datasets should return empty list for project with no datasets, got: {error}")

    async def test_when_project_does_not_exist_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project does not exist."""
        set_session(db_session)

        result = await list_datasets(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in str(error)
            case Success(_):
                pytest.fail("list_datasets should fail when project does not exist")

    async def test_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """list_datasets should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Simulate a database error by closing the session
        await seeded_db.close()

        metadata_repository = Mock(side_effect=SQLAlchemyError("Database connection lost"))
        result = await list_datasets(
            project_id="project-001",
            repositories={'metadata_repository': metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("list_datasets should fail when database error occurs")

