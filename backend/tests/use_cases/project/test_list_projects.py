"""Tests for list_projects use case."""

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
        """list_projects should return Result containing paginated dict with items."""
        set_session(seeded_db)

        result = await list_projects()

        match result:
            case Success(data):
                projects = data["items"]
                assert len(projects) == 2
                assert data["has_more"] is False
                assert data["next_cursor"] is None
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
        """list_projects should return empty items when no projects exist."""
        set_session(db_session)

        result = await list_projects()

        match result:
            case Success(data):
                assert data["items"] == []
                assert data["has_more"] is False
            case Failure(error):
                pytest.fail(f"list_projects should return empty list, got: {error}")

    async def test_list_projects_when_multiple_projects_orders_by_id_desc(self, db_session: AsyncSession):
        """list_projects should order projects by ID descending (UUIDv7 = chronological)."""
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
            case Success(data):
                projects = data["items"]
                # Most recently created first (highest UUIDv7 ID)
                assert projects[0]["id"] == PROJECT_SORT_3
                assert projects[1]["id"] == PROJECT_SORT_2
                assert projects[2]["id"] == PROJECT_SORT_1
            case Failure(error):
                pytest.fail(f"list_projects should return ordered projects, got: {error}")

    async def test_list_projects_when_database_error_returns_failure(self, seeded_db: AsyncSession):
        """list_projects should return Failure when a database error occurs."""
        set_session(seeded_db)

        class FailingMetadataRepository:
            async def list_projects(self, org_id=None, cursor=None, limit=50):
                raise SQLAlchemyError("Database connection lost")

        result = await list_projects(
            repositories={"metadata_repository": FailingMetadataRepository},
        )

        match result:
            case Failure(error):
                assert "Database connection lost" in str(error)
            case Success(_):
                pytest.fail("list_projects should fail when database error occurs")

    async def test_list_projects_pagination(self, db_session: AsyncSession):
        """list_projects should paginate results when page_size is set."""
        set_session(db_session)

        p1 = ProjectRecord(id=PROJECT_SORT_1, name="First", org_id=ORG_1)
        p2 = ProjectRecord(id=PROJECT_SORT_2, name="Second", org_id=ORG_1)
        p3 = ProjectRecord(id=PROJECT_SORT_3, name="Third", org_id=ORG_1)
        db_session.add_all([p1, p2, p3])
        await db_session.commit()

        # First page
        result = await list_projects(page_size=2)
        match result:
            case Success(data):
                assert len(data["items"]) == 2
                assert data["has_more"] is True
                assert data["next_cursor"] is not None

                # Second page
                result2 = await list_projects(cursor=data["next_cursor"], page_size=2)
                match result2:
                    case Success(data2):
                        assert len(data2["items"]) == 1
                        assert data2["has_more"] is False
                    case Failure(error):
                        pytest.fail(f"Second page should succeed, got: {error}")
            case Failure(error):
                pytest.fail(f"First page should succeed, got: {error}")
