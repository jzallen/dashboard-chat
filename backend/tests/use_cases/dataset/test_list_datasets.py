from unittest.mock import Mock

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dataset import Dataset
from app.models.transform import Transform
from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.types import QueryBuilderJSON
from app.use_cases.dataset import list_datasets
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, DATASET_3, PROJECT_1, PROJECT_2, PROJECT_EMPTY, TRANSFORM_1


class TestListDatasets:
    """Tests for list_datasets workflow."""

    async def test_list_datasets_when_project_has_datasets_returns_all_datasets(self, seeded_db: AsyncSession):
        """list_datasets should return all datasets belonging to the project."""
        set_session(seeded_db)

        result = await list_datasets(project_id=PROJECT_1)

        match result:
            case Success(datasets):
                assert len(datasets) == 2
                # Ordered by created_at desc — dataset-002 first, dataset-001 second
                expected_first = Dataset(
                    id=DATASET_2,
                    project_id=PROJECT_1,
                    name="Dataset Two",
                    schema_config={"fields": {"col2": {"type": "number"}}},
                    transforms=[],
                )
                assert datasets[0] == expected_first

                expected_second = Dataset(
                    id=DATASET_1,
                    project_id=PROJECT_1,
                    name="Dataset One",
                    schema_config={"fields": {"col1": {"type": "text"}}},
                    transforms=[
                        Transform(
                            id=TRANSFORM_1,
                            name="Filter Active",
                            condition_json=QueryBuilderJSON({"id": "root", "type": "group", "children1": []}),
                            condition_sql="col1 = 'active'",
                            description="Filter for active records",
                            status="enabled",
                            transform_type="filter",
                            created_at=datasets[1].transforms[0].created_at,
                        )
                    ],
                )
                assert datasets[1] == expected_second
            case Failure(error):
                pytest.fail(f"list_datasets should return datasets for valid project_id, got: {error}")

    async def test_list_datasets_when_project_id_is_none_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project_id is None."""
        set_session(db_session)

        result = await list_datasets(project_id=None)

        match result:
            case Failure(error):
                assert "project_id is required" in str(error)
            case Success(_):
                pytest.fail("list_datasets should fail when project_id is None")

    async def test_list_datasets_when_multiple_projects_returns_only_specified(self, seeded_db: AsyncSession):
        """list_datasets should return only datasets belonging to the specified project."""
        set_session(seeded_db)

        # Arrange: Add a second project and dataset
        new_project = ProjectRecord(
            id=PROJECT_2,
            name="Another Project",
        )
        seeded_db.add(new_project)

        new_dataset = DatasetRecord(
            id=DATASET_3,
            project_id=PROJECT_2,
            name="Dataset Three",
            schema_config={"fields": {"col3": {"type": "boolean"}}},
        )
        seeded_db.add(new_dataset)

        await seeded_db.commit()

        # Act
        result = await list_datasets(project_id=PROJECT_1)

        # Assert
        match result:
            case Success(datasets):
                assert new_dataset not in datasets
            case Failure(error):
                pytest.fail(f"list_datasets should filter by project_id, got: {error}")

    async def test_list_datasets_when_project_has_no_datasets_returns_empty_list(self, db_session: AsyncSession):
        """list_datasets should return empty list when project has no datasets."""
        set_session(db_session)

        project = ProjectRecord(
            id=PROJECT_EMPTY,
            name="Empty Project",
        )
        db_session.add(project)
        await db_session.commit()

        result = await list_datasets(project_id=PROJECT_EMPTY)

        match result:
            case Success(datasets):
                assert datasets == []
            case Failure(error):
                pytest.fail(f"list_datasets should return empty list for project with no datasets, got: {error}")

    async def test_list_datasets_when_project_does_not_exist_returns_failure(self, db_session: AsyncSession):
        """list_datasets should return Failure when project does not exist."""
        set_session(db_session)

        result = await list_datasets(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in str(error)
            case Success(_):
                pytest.fail("list_datasets should fail when project does not exist")

    async def test_list_datasets_when_database_error_occurs_returns_failure(self, seeded_db: AsyncSession):
        """list_datasets should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Simulate a database error by closing the session
        await seeded_db.close()

        metadata_repository = Mock(side_effect=SQLAlchemyError("Database connection lost"))
        result = await list_datasets(
            project_id=PROJECT_1,
            repositories={"metadata_repository": metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("list_datasets should fail when database error occurs")
