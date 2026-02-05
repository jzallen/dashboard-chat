"""Tests for create_project use case."""

import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.use_cases.project import create_project
from app.repositories import set_session


class TestCreateProject:
    """Tests for create_project workflow."""

    async def test_creates_project_with_name_only(self, db_session: AsyncSession):
        """create_project should create a project with just a name."""
        set_session(db_session)

        result = await create_project(name="New Project")

        match result:
            case Success(project):
                assert project["name"] == "New Project"
                assert project["description"] is None
                assert "id" in project
                assert "created_at" in project
                assert "updated_at" in project
            case Failure(error):
                pytest.fail(f"create_project should create project, got: {error}")

    async def test_creates_project_with_name_and_description(self, db_session: AsyncSession):
        """create_project should create a project with name and description."""
        set_session(db_session)

        result = await create_project(name="Test Project", description="A test description")

        match result:
            case Success(project):
                assert project["name"] == "Test Project"
                assert project["description"] == "A test description"
            case Failure(error):
                pytest.fail(f"create_project should create project with description, got: {error}")

    async def test_when_database_error_returns_failure(self, db_session: AsyncSession):
        """create_project should return Failure when a database error occurs."""
        set_session(db_session)

        # Close the session to simulate a database error
        await db_session.close()

        metadata_repository = Mock()
        metadata_repository.create_project = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await create_project(
            name="New Project",
            repositories={'metadata_repository': lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "[create_project]" in error
                assert "Database connection lost" in error
            case Success(_):
                pytest.fail("create_project should fail when database error occurs")
