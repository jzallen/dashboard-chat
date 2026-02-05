"""Tests for update_project use case."""

import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.use_cases.project import update_project
from app.repositories import set_session


class TestUpdateProject:
    """Tests for update_project workflow."""

    async def test_updates_project_name(self, seeded_db: AsyncSession):
        """update_project should update project name."""
        set_session(seeded_db)

        result = await update_project(
            project_id="project-001",
            update_data={"name": "Updated Name"},
        )

        match result:
            case Success(project):
                assert project["id"] == "project-001"
                assert project["name"] == "Updated Name"
                # Description should remain unchanged
                assert project["description"] == "A test project"
            case Failure(error):
                pytest.fail(f"update_project should update name, got: {error}")

    async def test_updates_project_description(self, seeded_db: AsyncSession):
        """update_project should update project description."""
        set_session(seeded_db)

        result = await update_project(
            project_id="project-001",
            update_data={"description": "Updated description"},
        )

        match result:
            case Success(project):
                assert project["id"] == "project-001"
                assert project["description"] == "Updated description"
                # Name should remain unchanged
                assert project["name"] == "Test Project"
            case Failure(error):
                pytest.fail(f"update_project should update description, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """update_project should return Failure when project does not exist."""
        set_session(seeded_db)

        result = await update_project(
            project_id="nonexistent-project",
            update_data={"name": "New Name"},
        )

        match result:
            case Failure(error):
                assert "[update_project]" in error
                assert "Project with ID 'nonexistent-project' not found" in error
            case Success(_):
                pytest.fail("update_project should fail for nonexistent project")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """update_project should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = Mock()
        metadata_repository.update_project = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await update_project(
            project_id="project-001",
            update_data={"name": "New Name"},
            repositories={'metadata_repository': lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "[update_project]" in error
                assert "Database connection lost" in error
            case Success(_):
                pytest.fail("update_project should fail when database error occurs")
