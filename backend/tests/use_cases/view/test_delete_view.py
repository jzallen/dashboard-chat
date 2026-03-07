"""Tests for delete_view use case."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.use_cases.view import delete_view
from app.use_cases.view.exceptions import ViewNotFound
from tests.uuidv7_fixtures import VIEW_1


class TestDeleteView:
    """Tests for delete_view workflow."""

    async def test_delete_existing_view(self, seeded_db_with_view: AsyncSession):
        """delete_view should delete an existing view."""
        set_session(seeded_db_with_view)

        result = await delete_view(VIEW_1)

        match result:
            case Success(deleted):
                assert deleted is True
            case Failure(error):
                pytest.fail(f"delete_view should succeed, got: {error}")

    async def test_delete_nonexistent_view(self, seeded_db: AsyncSession):
        """delete_view should fail for nonexistent view."""
        set_session(seeded_db)

        result = await delete_view("nonexistent-id")

        match result:
            case Failure(error):
                assert isinstance(error, ViewNotFound)
            case Success(_):
                pytest.fail("delete_view should fail for nonexistent view")
