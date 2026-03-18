"""Tests for update_view use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.view import update_view
from app.use_cases.view.exceptions import ViewNotFound
from tests.uuidv7_fixtures import DATASET_1, VIEW_1


class TestUpdateView:
    """Tests for update_view workflow."""

    async def test_update_view_name(self, seeded_db_with_view: AsyncSession):
        """update_view should update the view name."""
        set_session(seeded_db_with_view)

        result = await update_view(VIEW_1, {"name": "Updated Name"})

        match result:
            case Success(view):
                assert view.name == "Updated Name"
                assert view.id == VIEW_1
            case Failure(error):
                pytest.fail(f"update_view should succeed, got: {error}")

    async def test_update_view_sql_definition(self, seeded_db_with_view: AsyncSession):
        """update_view should update the SQL definition."""
        set_session(seeded_db_with_view)

        result = await update_view(VIEW_1, {"sql_definition": "SELECT new_col FROM t"})

        match result:
            case Success(view):
                assert view.sql_definition == "SELECT new_col FROM t"
            case Failure(error):
                pytest.fail(f"update_view should succeed, got: {error}")

    async def test_update_view_source_refs_validates(self, seeded_db_with_view: AsyncSession):
        """update_view should validate new source_refs."""
        set_session(seeded_db_with_view)

        # Valid ref
        result = await update_view(
            VIEW_1,
            {"source_refs": [{"id": DATASET_1, "type": "dataset"}]},
        )

        match result:
            case Success(view):
                assert len(view.source_refs) == 1
            case Failure(error):
                pytest.fail(f"update_view should succeed with valid refs, got: {error}")

    async def test_update_view_invalid_source_refs(self, seeded_db_with_view: AsyncSession):
        """update_view should fail with invalid source_refs."""
        set_session(seeded_db_with_view)

        result = await update_view(
            VIEW_1,
            {"source_refs": [{"id": "nonexistent", "type": "dataset"}]},
        )

        match result:
            case Failure(_):
                pass  # Expected
            case Success(_):
                pytest.fail("update_view should fail with invalid source refs")

    async def test_update_nonexistent_view(self, seeded_db: AsyncSession):
        """update_view should fail for nonexistent view."""
        set_session(seeded_db)

        result = await update_view("nonexistent-id", {"name": "New"})

        match result:
            case Failure(error):
                assert isinstance(error, ViewNotFound)
            case Success(_):
                pytest.fail("update_view should fail for nonexistent view")
