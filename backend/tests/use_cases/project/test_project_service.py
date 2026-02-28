"""Tests for ProjectService shared logic."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.auth.context import set_auth_user
from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.project.project_service import ProjectService
from tests.uuidv7_fixtures import ORG_1, ORG_OTHER, PROJECT_1, USER_1


def _make_repositories(metadata_repo):
    return SimpleNamespace(metadata=metadata_repo)


class TestFetchAndAuthorizeProject:
    """Tests for ProjectService.fetch_and_authorize_project."""

    async def test_returns_project_when_found_and_org_matches(self):
        """Should return project dict when project exists and org matches."""
        set_auth_user(AuthUser(id=USER_1, email="a@b.com", org_id=ORG_1, name="Test"))
        project_dict = {"id": PROJECT_1, "name": "My Project", "org_id": ORG_1}

        metadata_repo = AsyncMock()
        metadata_repo.get_project = AsyncMock(return_value=project_dict)

        svc = ProjectService(_make_repositories(metadata_repo))
        result = await svc.fetch_and_authorize_project(PROJECT_1)

        assert result == project_dict
        metadata_repo.get_project.assert_awaited_once_with(PROJECT_1, include_datasets=False)

    async def test_raises_project_not_found_when_none(self):
        """Should raise ProjectNotFound when repository returns None."""
        set_auth_user(AuthUser(id=USER_1, email="a@b.com", org_id=ORG_1, name="Test"))

        metadata_repo = AsyncMock()
        metadata_repo.get_project = AsyncMock(return_value=None)

        svc = ProjectService(_make_repositories(metadata_repo))

        with pytest.raises(ProjectNotFound, match="not found"):
            await svc.fetch_and_authorize_project("nonexistent-id")

    async def test_raises_authorization_error_when_org_mismatch(self):
        """Should raise AuthorizationError when user org does not match project org."""
        set_auth_user(AuthUser(id=USER_1, email="a@b.com", org_id=ORG_1, name="Test"))
        project_dict = {"id": PROJECT_1, "name": "Other Project", "org_id": ORG_OTHER}

        metadata_repo = AsyncMock()
        metadata_repo.get_project = AsyncMock(return_value=project_dict)

        svc = ProjectService(_make_repositories(metadata_repo))

        with pytest.raises(AuthorizationError, match="Access denied"):
            await svc.fetch_and_authorize_project(PROJECT_1)

    async def test_passes_include_datasets_true(self):
        """Should forward include_datasets=True to the repository."""
        set_auth_user(AuthUser(id=USER_1, email="a@b.com", org_id=ORG_1, name="Test"))
        project_dict = {
            "id": PROJECT_1,
            "name": "My Project",
            "org_id": ORG_1,
            "datasets": [{"id": "ds-1", "name": "DS"}],
        }

        metadata_repo = AsyncMock()
        metadata_repo.get_project = AsyncMock(return_value=project_dict)

        svc = ProjectService(_make_repositories(metadata_repo))
        result = await svc.fetch_and_authorize_project(PROJECT_1, include_datasets=True)

        assert result == project_dict
        metadata_repo.get_project.assert_awaited_once_with(PROJECT_1, include_datasets=True)

    async def test_allows_access_when_project_org_id_is_none(self):
        """Should allow access for legacy projects with no org_id."""
        set_auth_user(AuthUser(id=USER_1, email="a@b.com", org_id=ORG_1, name="Test"))
        project_dict = {"id": PROJECT_1, "name": "Legacy Project", "org_id": None}

        metadata_repo = AsyncMock()
        metadata_repo.get_project = AsyncMock(return_value=project_dict)

        svc = ProjectService(_make_repositories(metadata_repo))
        result = await svc.fetch_and_authorize_project(PROJECT_1)

        assert result == project_dict


class TestFetchFullDatasets:
    """Tests for ProjectService.fetch_full_datasets."""

    async def test_returns_empty_list_when_no_datasets(self):
        """Should return empty list when project has no datasets."""
        metadata_repo = AsyncMock()
        svc = ProjectService(_make_repositories(metadata_repo))

        result = await svc.fetch_full_datasets({"datasets": []})

        assert result == []

    async def test_skips_datasets_not_found_in_repo(self):
        """Should skip datasets that return None from the repository."""
        metadata_repo = AsyncMock()
        metadata_repo.get_dataset_record = AsyncMock(return_value=None)

        svc = ProjectService(_make_repositories(metadata_repo))
        result = await svc.fetch_full_datasets({"datasets": [{"id": "missing-ds"}]})

        assert result == []
