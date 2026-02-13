"""Tests for list_projects use case."""

import pytest
from unittest.mock import Mock
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from app.use_cases.project import list_projects
from app.repositories import set_session
from app.repositories.metadata import ProjectRecord


class TestListProjects:
    """Tests for list_projects workflow."""

    async def test_returns_list_of_projects(self, seeded_db: AsyncSession):
        """list_projects should return Result containing list[dict]."""
        set_session(seeded_db)

        result = await list_projects()

        match result:
            case Success(projects):
                assert len(projects) == 2
                # Ordered by created_at desc, so most recent first
                assert projects[0]["id"] == "project-002"
                assert projects[0]["name"] == "Another Project"
                assert projects[1]["id"] == "project-001"
                assert projects[1]["name"] == "Test Project"
            case Failure(error):
                pytest.fail(f"list_projects should return projects, got: {error}")

    async def test_returns_empty_list_when_no_projects(self, db_session: AsyncSession):
        """list_projects should return empty list when no projects exist."""
        set_session(db_session)

        result = await list_projects()

        match result:
            case Success(projects):
                assert projects == []
            case Failure(error):
                pytest.fail(f"list_projects should return empty list, got: {error}")

    async def test_orders_by_created_at_desc(self, db_session: AsyncSession):
        """list_projects should order projects by created_at descending."""
        set_session(db_session)

        # Create projects in a specific order
        p1 = ProjectRecord(id="p1", name="First", org_id="test-org-001")
        db_session.add(p1)
        await db_session.flush()

        p2 = ProjectRecord(id="p2", name="Second", org_id="test-org-001")
        db_session.add(p2)
        await db_session.flush()

        p3 = ProjectRecord(id="p3", name="Third", org_id="test-org-001")
        db_session.add(p3)
        await db_session.commit()

        result = await list_projects()

        match result:
            case Success(projects):
                # Most recently created first
                assert projects[0]["id"] == "p3"
                assert projects[1]["id"] == "p2"
                assert projects[2]["id"] == "p1"
            case Failure(error):
                pytest.fail(f"list_projects should return ordered projects, got: {error}")

    async def test_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """list_projects should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = Mock()
        metadata_repository.list_projects = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await list_projects(
            repositories={'metadata_repository': lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("list_projects should fail when database error occurs")
