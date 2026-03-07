"""Tests for list_views use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import ViewRecord
from app.use_cases.view import list_views
from tests.uuidv7_fixtures import ORG_1, PROJECT_1, VIEW_1, VIEW_2


class TestListViews:
    """Tests for list_views workflow."""

    async def test_list_views_empty(self, seeded_db: AsyncSession):
        """list_views should return empty list when no views exist."""
        set_session(seeded_db)

        result = await list_views(PROJECT_1)

        match result:
            case Success(views):
                assert views == []
            case Failure(error):
                pytest.fail(f"list_views should succeed, got: {error}")

    async def test_list_views_with_views(self, seeded_db: AsyncSession):
        """list_views should return all views for the project."""
        set_session(seeded_db)
        v1 = ViewRecord(id=VIEW_1, project_id=PROJECT_1, org_id=ORG_1, name="V1", sql_definition="SELECT 1")
        v2 = ViewRecord(id=VIEW_2, project_id=PROJECT_1, org_id=ORG_1, name="V2", sql_definition="SELECT 2")
        seeded_db.add(v1)
        seeded_db.add(v2)
        await seeded_db.commit()

        result = await list_views(PROJECT_1)

        match result:
            case Success(views):
                assert len(views) == 2
                names = {v.name for v in views}
                assert names == {"V1", "V2"}
            case Failure(error):
                pytest.fail(f"list_views should succeed, got: {error}")

    async def test_list_views_nonexistent_project(self, seeded_db: AsyncSession):
        """list_views should fail for nonexistent project."""
        set_session(seeded_db)

        result = await list_views("nonexistent-project")

        match result:
            case Failure(_):
                pass  # Expected
            case Success(_):
                pytest.fail("list_views should fail for nonexistent project")
