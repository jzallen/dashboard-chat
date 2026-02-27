"""Tests for update_project use case."""

from unittest.mock import AsyncMock

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.project import update_project
from tests.uuidv7_fixtures import ORG_1, PROJECT_1


class TestUpdateProject:
    """Tests for update_project workflow."""

    async def test_update_project_when_name_provided_updates_name(self, seeded_db: AsyncSession):
        """update_project should update project name."""
        set_session(seeded_db)

        result = await update_project(
            project_id=PROJECT_1,
            update_data={"name": "Updated Name"},
        )

        match result:
            case Success(project):
                assert project == {
                    "id": PROJECT_1,
                    "name": "Updated Name",
                    "description": "A test project",
                    "org_id": ORG_1,
                    "created_by": None,
                    "created_at": project["created_at"],
                    "updated_at": project["updated_at"],
                }
            case Failure(error):
                pytest.fail(f"update_project should update name, got: {error}")

    async def test_update_project_when_description_provided_updates_description(self, seeded_db: AsyncSession):
        """update_project should update project description."""
        set_session(seeded_db)

        result = await update_project(
            project_id=PROJECT_1,
            update_data={"description": "Updated description"},
        )

        match result:
            case Success(project):
                assert project == {
                    "id": PROJECT_1,
                    "name": "Test Project",
                    "description": "Updated description",
                    "org_id": ORG_1,
                    "created_by": None,
                    "created_at": project["created_at"],
                    "updated_at": project["updated_at"],
                }
            case Failure(error):
                pytest.fail(f"update_project should update description, got: {error}")

    async def test_update_project_when_project_not_found_returns_failure(self, seeded_db: AsyncSession):
        """update_project should return Failure when project does not exist."""
        set_session(seeded_db)

        result = await update_project(
            project_id="nonexistent-project",
            update_data={"name": "New Name"},
        )

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in str(error)
            case Success(_):
                pytest.fail("update_project should fail for nonexistent project")

    async def test_update_project_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_project should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = AsyncMock()
        metadata_repository.get_project = AsyncMock(return_value={"id": PROJECT_1, "org_id": ORG_1, "name": "Test"})
        metadata_repository.update_project = AsyncMock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await update_project(
            project_id=PROJECT_1,
            update_data={"name": "New Name"},
            repositories={"metadata_repository": lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("update_project should fail when database error occurs")
