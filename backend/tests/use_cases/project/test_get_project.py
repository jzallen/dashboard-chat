"""Tests for get_project use case."""

import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.use_cases.project import get_project
from app.repositories import set_session
from app.repositories.metadata import ProjectRecord


class TestGetProject:
    """Tests for get_project workflow."""

    async def test_given_valid_id_returns_project_with_datasets(self, seeded_db: AsyncSession):
        """get_project should return project dict with datasets by default."""
        set_session(seeded_db)

        result = await get_project(project_id="project-001")

        match result:
            case Success(project):
                assert project["id"] == "project-001"
                assert project["name"] == "Test Project"
                assert project["description"] == "A test project"
                assert "datasets" in project
                assert len(project["datasets"]) == 2
                # Check sparse dataset info
                dataset_ids = {ds["id"] for ds in project["datasets"]}
                assert dataset_ids == {"dataset-001", "dataset-002"}
            case Failure(error):
                pytest.fail(f"get_project should return project, got: {error}")

    async def test_given_valid_id_without_datasets_flag_excludes_datasets(self, seeded_db: AsyncSession):
        """get_project with include_datasets=False should not include datasets."""
        set_session(seeded_db)

        result = await get_project(project_id="project-001", include_datasets=False)

        match result:
            case Success(project):
                assert project["id"] == "project-001"
                assert "datasets" not in project
            case Failure(error):
                pytest.fail(f"get_project should return project without datasets, got: {error}")

    async def test_given_invalid_id_returns_failure(self, seeded_db: AsyncSession):
        """get_project should return Failure when project does not exist."""
        set_session(seeded_db)

        result = await get_project(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "[get_project]" in error
                assert "Project with ID 'nonexistent-project' not found" in error
            case Success(_):
                pytest.fail("get_project should fail for nonexistent project")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """get_project should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = Mock()
        metadata_repository.get_project = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await get_project(
            project_id="project-001",
            repositories={'metadata_repository': lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "[get_project]" in error
                assert "Database connection lost" in error
            case Success(_):
                pytest.fail("get_project should fail when database error occurs")
