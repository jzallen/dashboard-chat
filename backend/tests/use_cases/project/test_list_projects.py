"""Tests for list_projects use case."""

from unittest.mock import Mock

import pytest
from returns.result import Failure, Success
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import ProjectRecord
from app.use_cases.project import list_projects
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_2,
    ORG_1,
    PROJECT_1,
    PROJECT_2,
    PROJECT_SORT_1,
    PROJECT_SORT_2,
    PROJECT_SORT_3,
)


class TestListProjects:
    """Tests for list_projects workflow."""

    async def test_list_projects_when_projects_exist_returns_all(self, seeded_db: AsyncSession):
        """list_projects should return Result containing list[dict]."""
        set_session(seeded_db)

        result = await list_projects()

        match result:
            case Success(projects):
                # Normalize dataset order within each project for deterministic comparison
                for p in projects:
                    p["datasets"] = sorted(p["datasets"], key=lambda d: d["id"])
                assert projects == [
                    {
                        "id": PROJECT_2,
                        "name": "Another Project",
                        "description": None,
                        "org_id": ORG_1,
                        "created_by": None,
                        "created_at": projects[0]["created_at"],
                        "updated_at": projects[0]["updated_at"],
                        "datasets": [],
                    },
                    {
                        "id": PROJECT_1,
                        "name": "Test Project",
                        "description": "A test project",
                        "org_id": ORG_1,
                        "created_by": None,
                        "created_at": projects[1]["created_at"],
                        "updated_at": projects[1]["updated_at"],
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
                    },
                ]
            case Failure(error):
                pytest.fail(f"list_projects should return projects, got: {error}")

    async def test_list_projects_when_no_projects_exist_returns_empty_list(self, db_session: AsyncSession):
        """list_projects should return empty list when no projects exist."""
        set_session(db_session)

        result = await list_projects()

        match result:
            case Success(projects):
                assert projects == []
            case Failure(error):
                pytest.fail(f"list_projects should return empty list, got: {error}")

    async def test_list_projects_when_multiple_projects_orders_by_created_at_desc(self, db_session: AsyncSession):
        """list_projects should order projects by created_at descending."""
        set_session(db_session)

        # Create projects in a specific order
        p1 = ProjectRecord(id=PROJECT_SORT_1, name="First", org_id=ORG_1)
        db_session.add(p1)
        await db_session.flush()

        p2 = ProjectRecord(id=PROJECT_SORT_2, name="Second", org_id=ORG_1)
        db_session.add(p2)
        await db_session.flush()

        p3 = ProjectRecord(id=PROJECT_SORT_3, name="Third", org_id=ORG_1)
        db_session.add(p3)
        await db_session.commit()

        result = await list_projects()

        match result:
            case Success(projects):
                # Most recently created first
                assert projects == [
                    {
                        "id": PROJECT_SORT_3,
                        "name": "Third",
                        "description": None,
                        "org_id": ORG_1,
                        "created_by": None,
                        "created_at": projects[0]["created_at"],
                        "updated_at": projects[0]["updated_at"],
                        "datasets": [],
                    },
                    {
                        "id": PROJECT_SORT_2,
                        "name": "Second",
                        "description": None,
                        "org_id": ORG_1,
                        "created_by": None,
                        "created_at": projects[1]["created_at"],
                        "updated_at": projects[1]["updated_at"],
                        "datasets": [],
                    },
                    {
                        "id": PROJECT_SORT_1,
                        "name": "First",
                        "description": None,
                        "org_id": ORG_1,
                        "created_by": None,
                        "created_at": projects[2]["created_at"],
                        "updated_at": projects[2]["updated_at"],
                        "datasets": [],
                    },
                ]
            case Failure(error):
                pytest.fail(f"list_projects should return ordered projects, got: {error}")

    async def test_list_projects_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """list_projects should return Failure when a database error occurs."""
        set_session(seeded_db)

        # Close the session to simulate a database error
        await seeded_db.close()

        metadata_repository = Mock()
        metadata_repository.list_projects = Mock(side_effect=SQLAlchemyError("Database connection lost"))

        result = await list_projects(
            repositories={"metadata_repository": lambda: metadata_repository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("list_projects should fail when database error occurs")
