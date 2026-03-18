"""Tests for create_view use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.view import create_view
from app.use_cases.view.exceptions import InvalidSourceReference
from tests.uuidv7_fixtures import DATASET_1, PROJECT_1


class TestCreateView:
    """Tests for create_view workflow."""

    async def test_create_view_with_required_fields(self, seeded_db: AsyncSession):
        """create_view should create a view with required fields."""
        set_session(seeded_db)

        result = await create_view(
            project_id=PROJECT_1,
            name="My View",
            sql_definition="SELECT * FROM source",
        )

        match result:
            case Success(view):
                assert view.name == "My View"
                assert view.sql_definition == "SELECT * FROM source"
                assert view.project_id == PROJECT_1
                assert view.materialization == "ephemeral"
                assert view.source_refs == []
            case Failure(error):
                pytest.fail(f"create_view should succeed, got: {error}")

    async def test_create_view_with_all_fields(self, seeded_db: AsyncSession):
        """create_view should accept all optional fields."""
        set_session(seeded_db)

        result = await create_view(
            project_id=PROJECT_1,
            name="Full View",
            sql_definition="SELECT a FROM b",
            source_refs=[{"id": DATASET_1, "type": "dataset"}],
            description="A description",
            materialization="table",
        )

        match result:
            case Success(view):
                assert view.description == "A description"
                assert view.materialization == "table"
                assert len(view.source_refs) == 1
            case Failure(error):
                pytest.fail(f"create_view should succeed, got: {error}")

    async def test_create_view_with_invalid_source_ref(self, seeded_db: AsyncSession):
        """create_view should fail when source refs are invalid."""
        set_session(seeded_db)

        result = await create_view(
            project_id=PROJECT_1,
            name="Bad View",
            sql_definition="SELECT 1",
            source_refs=[{"id": "nonexistent", "type": "dataset"}],
        )

        match result:
            case Failure(error):
                assert isinstance(error, InvalidSourceReference)
            case Success(_):
                pytest.fail("create_view should fail with invalid source refs")

    async def test_create_view_with_nonexistent_project(self, seeded_db: AsyncSession):
        """create_view should fail when project does not exist."""
        set_session(seeded_db)

        result = await create_view(
            project_id="nonexistent-project",
            name="My View",
            sql_definition="SELECT 1",
        )

        match result:
            case Failure(_):
                pass  # Expected
            case Success(_):
                pytest.fail("create_view should fail with nonexistent project")
