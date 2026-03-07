"""Tests for project authorization — org-based access control."""

import pytest
from returns.result import Failure, Success
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import set_auth_user
from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import ProjectRecord
from app.use_cases.project import create_project, get_project, list_projects
from tests.uuidv7_fixtures import (
    ORG_1,
    ORG_OTHER,
    ORG_ROUTE,
    PROJECT_EMPTY,
    PROJECT_MINE,
    PROJECT_OTHER,
    PROJECT_ROUTE_1,
    USER_1,
    USER_2,
)


class TestListProjectsAuth:
    """list_projects should filter by the authenticated user's org_id."""

    async def test_list_projects_when_mixed_orgs_returns_only_matching_org(self, db_session: AsyncSession):
        """Projects from a different org should not appear in results."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_MINE, name="My Project", org_id=ORG_1))
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other Org Project", org_id=ORG_OTHER))
        await db_session.commit()

        result = await list_projects()

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

        result = await list_projects()

        match result:
            case Success(data):
                assert data["items"] == []
            case Failure(error):
                pytest.fail(f"list_projects should succeed, got: {error}")


class TestCreateProjectAuth:
    """create_project should set org_id and created_by from auth context."""

    async def test_create_project_when_authenticated_sets_org_id_and_created_by(self, db_session: AsyncSession):
        """Created project should have the authenticated user's org_id and user id."""
        set_session(db_session)

        result = await create_project(name="Auth Project")

        match result:
            case Success(project):
                assert project["org_id"] == ORG_1
                assert project["created_by"] == USER_1
            case Failure(error):
                pytest.fail(f"create_project should succeed, got: {error}")


class TestGetProjectAuth:
    """get_project should enforce org-based authorization."""

    async def test_get_project_when_org_matches_allows_access(self, db_session: AsyncSession):
        """get_project should succeed when org_id matches."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_MINE, name="My Project", org_id=ORG_1))
        await db_session.commit()

        result = await get_project(project_id=PROJECT_MINE)

        match result:
            case Success(project):
                assert project["id"] == PROJECT_MINE
            case Failure(error):
                pytest.fail(f"get_project should succeed, got: {error}")

    async def test_get_project_when_org_mismatch_denies_access(self, db_session: AsyncSession):
        """get_project should return Failure with AuthorizationError for wrong org."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other", org_id=ORG_OTHER))
        await db_session.commit()

        result = await get_project(project_id=PROJECT_OTHER)

        match result:
            case Failure(error):
                assert "Access denied" in str(error)
            case Success(_):
                pytest.fail("get_project should deny access to project from different org")

    async def test_get_project_when_no_org_id_allows_access(self, db_session: AsyncSession):
        """get_project should allow access when project has no org_id (legacy data)."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_EMPTY, name="Legacy Project"))
        await db_session.commit()

        result = await get_project(project_id=PROJECT_EMPTY)

        match result:
            case Success(project):
                assert project["id"] == PROJECT_EMPTY
            case Failure(error):
                pytest.fail(f"get_project should allow legacy project access, got: {error}")

    async def test_get_project_when_different_auth_user_denies_access(self, db_session: AsyncSession):
        """Switching auth user should change authorization outcome."""
        set_session(db_session)

        db_session.add(ProjectRecord(id=PROJECT_ROUTE_1, name="Org A Project", org_id=ORG_ROUTE))
        await db_session.commit()

        # Set a different user than the default
        set_auth_user(AuthUser(id=USER_2, email="b@test.com", org_id=ORG_OTHER))

        result = await get_project(project_id=PROJECT_ROUTE_1)

        match result:
            case Failure(error):
                assert "Access denied" in str(error)
            case Success(_):
                pytest.fail("get_project should deny access when org doesn't match")
