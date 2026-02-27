"""Tests for get_project use case."""

from unittest.mock import Mock

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project import get_project
from tests.uuidv7_fixtures import DATASET_1, DATASET_2, ORG_1, PROJECT_1


class TestGetProject:
    """Tests for get_project workflow."""

    async def test_get_project_when_valid_id_returns_project_with_datasets(self, seeded_db: AsyncSession):
        """get_project should return project dict with datasets by default."""
        set_session(seeded_db)

        result = await get_project(project_id=PROJECT_1)

        match result:
            case Success(project):
                datasets = sorted(project["datasets"], key=lambda d: d["id"])
                assert {**project, "datasets": datasets} == {
                    "id": PROJECT_1,
                    "name": "Test Project",
                    "description": "A test project",
                    "org_id": ORG_1,
                    "created_by": None,
                    "created_at": project["created_at"],
                    "updated_at": project["updated_at"],
                    "datasets": [
                        {
                            "id": DATASET_1,
                            "name": "Dataset One",
                            "link": f"/api/datasets/{DATASET_1}",
                            "description": None,
                            "schema_config": {"fields": {"col1": {"type": "text"}}},
                        },
                        {
                            "id": DATASET_2,
                            "name": "Dataset Two",
                            "link": f"/api/datasets/{DATASET_2}",
                            "description": None,
                            "schema_config": {"fields": {"col2": {"type": "number"}}},
                        },
                    ],
                }
            case Failure(error):
                pytest.fail(f"get_project should return project, got: {error}")

    async def test_get_project_when_include_datasets_false_excludes_datasets(self, seeded_db: AsyncSession):
        """get_project with include_datasets=False should not include datasets."""
        set_session(seeded_db)

        result = await get_project(project_id=PROJECT_1, include_datasets=False)

        match result:
            case Success(project):
                assert project == {
                    "id": PROJECT_1,
                    "name": "Test Project",
                    "description": "A test project",
                    "org_id": ORG_1,
                    "created_by": None,
                    "created_at": project["created_at"],
                    "updated_at": project["updated_at"],
                }
                assert "datasets" not in project
            case Failure(error):
                pytest.fail(f"get_project should return project without datasets, got: {error}")

    async def test_get_project_when_project_not_found_returns_failure(self, seeded_db: AsyncSession):
        """get_project should return Failure when project does not exist."""
        set_session(seeded_db)

        result = await get_project(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in str(error)
            case Success(_):
                pytest.fail("get_project should fail for nonexistent project")

    async def test_get_project_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """get_project should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = Mock()
        metadata_repository.get_project = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await get_project(
            project_id=PROJECT_1,
            repositories={"metadata_repository": lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("get_project should fail when database error occurs")
