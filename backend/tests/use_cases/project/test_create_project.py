"""Tests for create_project use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.use_cases.project import create_project
from tests.uuidv7_fixtures import ORG_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


class TestCreateProject:
    """Tests for create_project workflow."""

    async def test_create_project_when_name_only_returns_project(self, db_session: AsyncSession):
        """create_project should create a project with just a name."""
        set_session(db_session)

        result = await create_project(name="New Project", user=TEST_USER)

        match result:
            case Success(project):
                assert project["name"] == "New Project"
                assert project["description"] is None
                assert "id" in project
                assert "created_at" in project
                assert "updated_at" in project
            case Failure(error):
                pytest.fail(f"create_project should create project, got: {error}")

    async def test_create_project_when_name_and_description_returns_project(self, db_session: AsyncSession):
        """create_project should create a project with name and description."""
        set_session(db_session)

        result = await create_project(name="Test Project", user=TEST_USER, description="A test description")

        match result:
            case Success(project):
                assert project["name"] == "Test Project"
                assert project["description"] == "A test description"
            case Failure(error):
                pytest.fail(f"create_project should create project with description, got: {error}")

    async def test_create_project_when_database_error_returns_failure(self, db_session: AsyncSession):
        """create_project should return Failure when a database error occurs."""
        set_session(db_session)

        class FailingMetadataRepository:
            async def create_project(self, **kwargs):
                raise SQLAlchemyError("Database connection lost")

        result = await create_project(
            name="New Project",
            user=TEST_USER,
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("create_project should fail when database error occurs")
