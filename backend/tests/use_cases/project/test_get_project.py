"""Tests for get_project use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project import get_project
from tests.uuidv7_fixtures import ORG_1, PROJECT_1


class TestGetProject:
    """Tests for get_project workflow."""

    async def test_get_project_returns_project_metadata_only(self, seeded_db: AsyncSession):
        """get_project should return project metadata without datasets."""
        set_session(seeded_db)

        result = await get_project(project_id=PROJECT_1)

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
                pytest.fail(f"get_project should return project, got: {error}")

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

        class FailingMetadataRepository:
            async def get_project(self, project_id):
                raise SQLAlchemyError("Database connection lost")

        result = await get_project(
            project_id=PROJECT_1,
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("get_project should fail when database error occurs")
