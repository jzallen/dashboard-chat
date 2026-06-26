"""Tests for project authorization — org-based access control.

NOTE: Per-resource authorization (org_id ownership check) has moved to the
router layer via `authorize_project_access()` in deps.py. Tests for that
are in tests/auth/test_deps.py. This file tests auth concerns that remain
in use cases: list_projects filtering and create_project org/user stamping.
"""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import ProjectRecord
from app.use_cases.project import (
    create_project,
    delete_project,
    get_project,
    list_projects,
    update_project,
)
from tests.uuidv7_fixtures import (
    ORG_1,
    ORG_OTHER,
    PROJECT_MINE,
    PROJECT_OTHER,
    USER_1,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


class TestListProjectsAuth:
    """list_projects should filter by the authenticated user's org_id."""

    async def test_list_projects_when_mixed_orgs_returns_only_matching_org(self, db_session: AsyncSession):
        """Projects from a different org should not appear in results."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_MINE, name="My Project", org_id=ORG_1))
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other Org Project", org_id=ORG_OTHER))
        await db_session.commit()

        result = await list_projects(user=TEST_USER)

        match result:
            case Success(data):
                assert len(data["items"]) == 1
                assert data["items"][0]["id"] == PROJECT_MINE
            case Failure(error):
                pytest.fail(f"list_projects should succeed, got: {error}")

    async def test_list_projects_when_no_matching_org_returns_empty_list(self, db_session: AsyncSession):
        """If all projects belong to a different org, should return empty list."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other", org_id=ORG_OTHER))
        await db_session.commit()

        result = await list_projects(user=TEST_USER)

        match result:
            case Success(data):
                assert data["items"] == []
            case Failure(error):
                pytest.fail(f"list_projects should succeed, got: {error}")

    async def test_list_projects_with_explicit_user(self, db_session: AsyncSession):
        """list_projects should use the explicitly passed user."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_MINE, name="My Project", org_id=ORG_1))
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other", org_id=ORG_OTHER))
        await db_session.commit()

        other_user = AuthUser(id="other", email="other@test.com", org_id=ORG_OTHER)
        result = await list_projects(user=other_user)

        match result:
            case Success(data):
                assert len(data["items"]) == 1
                assert data["items"][0]["id"] == PROJECT_OTHER
            case Failure(error):
                pytest.fail(f"list_projects should succeed, got: {error}")


class TestCrossTenantPointAccess:
    """get/update/delete reject a cross-tenant project_id at the repository layer.

    The repository scopes its query by the caller's org, so a project owned by a
    different org is indistinguishable from not-found even if the router edge
    check were bypassed — this exercises that defense-in-depth via the use case.
    """

    async def _seed(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_MINE, name="Mine", org_id=ORG_1))
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Theirs", org_id=ORG_OTHER))
        await db_session.commit()

    async def test_get_project_for_other_org_returns_not_found(self, db_session: AsyncSession):
        await self._seed(db_session)
        result = await get_project(project_id=PROJECT_OTHER, user=TEST_USER)
        assert isinstance(result, Failure)
        assert "not found" in str(result.failure())

    async def test_update_project_for_other_org_returns_not_found_and_no_mutation(self, db_session: AsyncSession):
        await self._seed(db_session)
        result = await update_project(project_id=PROJECT_OTHER, update_data={"name": "Hijacked"}, user=TEST_USER)
        assert isinstance(result, Failure)
        assert "not found" in str(result.failure())
        # The other org's row is untouched.
        other_user = AuthUser(id="other", email="o@test.com", org_id=ORG_OTHER)
        reread = await get_project(project_id=PROJECT_OTHER, user=other_user)
        assert reread.unwrap()["name"] == "Theirs"

    async def test_delete_project_for_other_org_returns_not_found_and_no_delete(self, db_session: AsyncSession):
        await self._seed(db_session)
        result = await delete_project(project_id=PROJECT_OTHER, user=TEST_USER)
        assert isinstance(result, Failure)
        assert "not found" in str(result.failure())
        # The other org's row still exists.
        other_user = AuthUser(id="other", email="o@test.com", org_id=ORG_OTHER)
        reread = await get_project(project_id=PROJECT_OTHER, user=other_user)
        assert isinstance(reread, Success)


class TestCreateProjectAuth:
    """create_project should set org_id and created_by from auth context."""

    async def test_create_project_when_authenticated_sets_org_id_and_created_by(self, db_session: AsyncSession):
        """Created project should have the authenticated user's org_id and user id."""
        set_session(db_session)

        result = await create_project(name="Auth Project", user=TEST_USER)

        match result:
            case Success(project):
                assert project["org_id"] == ORG_1
                assert project["created_by"] == USER_1
            case Failure(error):
                pytest.fail(f"create_project should succeed, got: {error}")

    async def test_create_project_with_explicit_user(self, db_session: AsyncSession):
        """create_project should use the explicitly passed user."""
        set_session(db_session)

        custom_user = AuthUser(id="custom-user", email="custom@test.com", org_id="custom-org")
        result = await create_project(name="Custom Project", user=custom_user)

        match result:
            case Success(project):
                assert project["org_id"] == "custom-org"
                assert project["created_by"] == "custom-user"
            case Failure(error):
                pytest.fail(f"create_project should succeed, got: {error}")
