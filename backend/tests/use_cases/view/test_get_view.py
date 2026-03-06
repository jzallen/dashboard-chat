"""Tests for get_view use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.view import get_view
from app.use_cases.view.exceptions import ViewNotFound
from tests.uuidv7_fixtures import VIEW_1


class TestGetView:
    """Tests for get_view workflow."""

    async def test_get_existing_view(self, seeded_db_with_view: AsyncSession):
        """get_view should return a View when it exists."""
        set_session(seeded_db_with_view)

        result = await get_view(VIEW_1)

        match result:
            case Success(view):
                assert view.id == VIEW_1
                assert view.name == "Existing View"
                assert view.sql_definition == "SELECT * FROM source"
            case Failure(error):
                pytest.fail(f"get_view should succeed, got: {error}")

    async def test_get_nonexistent_view(self, seeded_db: AsyncSession):
        """get_view should return Failure with ViewNotFound."""
        set_session(seeded_db)

        result = await get_view("nonexistent-id")

        match result:
            case Failure(error):
                assert isinstance(error, ViewNotFound)
            case Success(_):
                pytest.fail("get_view should fail for nonexistent view")
