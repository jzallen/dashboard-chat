"""Tests for delete_project use case."""

from unittest.mock import AsyncMock

import pytest
from returns.result import Failure, Success
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.use_cases.project import delete_project
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, PROJECT_2


class TestDeleteProject:
    """Tests for delete_project workflow."""

    async def test_delete_project_when_project_exists_returns_true(self, seeded_db: AsyncSession):
        """delete_project should delete project and return True."""
        set_session(seeded_db)

        result = await delete_project(project_id=PROJECT_2)

        match result:
            case Success(deleted):
                assert deleted is True
                # Verify project was actually deleted
                check_result = await seeded_db.execute(select(ProjectRecord).where(ProjectRecord.id == PROJECT_2))
                assert check_result.scalar_one_or_none() is None
            case Failure(error):
                pytest.fail(f"delete_project should delete project, got: {error}")

    async def test_delete_project_when_project_not_found_returns_failure(self, seeded_db: AsyncSession):
        """delete_project should return Failure when project does not exist."""
        set_session(seeded_db)

        result = await delete_project(project_id="nonexistent-project")

        match result:
            case Failure(error):
                assert "Project with ID 'nonexistent-project' not found" in str(error)
            case Success(_):
                pytest.fail("delete_project should fail for nonexistent project")

    async def test_delete_project_when_project_has_datasets_cascades_deletion(self, seeded_db: AsyncSession):
        """delete_project should cascade delete to datasets."""
        set_session(seeded_db)

        # Verify datasets exist before delete
        check_before = await seeded_db.execute(select(DatasetRecord).where(DatasetRecord.project_id == PROJECT_1))
        assert len(list(check_before.scalars().all())) == 2

        result = await delete_project(project_id=PROJECT_1)

        match result:
            case Success(deleted):
                assert deleted is True
                # Verify datasets were cascade deleted
                check_after = await seeded_db.execute(
                    select(DatasetRecord).where(DatasetRecord.project_id == PROJECT_1)
                )
                assert len(list(check_after.scalars().all())) == 0
            case Failure(error):
                pytest.fail(f"delete_project should cascade delete datasets, got: {error}")

    async def test_delete_project_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """delete_project should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = AsyncMock()
        metadata_repository.get_project = AsyncMock(return_value={"id": PROJECT_1, "org_id": ORG_1, "name": "Test"})
        metadata_repository.delete_project = AsyncMock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await delete_project(
            project_id=PROJECT_1,
            repositories={"metadata_repository": lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("delete_project should fail when database error occurs")
