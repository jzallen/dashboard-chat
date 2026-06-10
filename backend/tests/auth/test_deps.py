"""Tests for router-level authorization dependencies."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.exceptions import AuthorizationError
from app.auth.types import AuthUser
from app.repositories import set_session
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.routers.deps import authorize_dataset_access, authorize_project_access, get_current_user
from app.use_cases.dataset.exceptions import DatasetNotFound
from app.use_cases.project.exceptions import ProjectNotFound
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_OTHER,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_OTHER,
    USER_1,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


class TestGetCurrentUser:
    """get_current_user reads from proxy headers or falls back to contextvar."""

    async def test_fallback_to_contextvar_when_no_proxy_headers(self):
        """Without proxy headers, should return the contextvar user."""
        from starlette.requests import Request

        scope = {"type": "http", "headers": []}
        request = Request(scope)

        user = await get_current_user(request)

        assert user.id == USER_1
        assert user.org_id == ORG_1

    async def test_reads_proxy_headers_when_trust_enabled(self, monkeypatch):
        """With TRUST_PROXY_HEADERS=true, should read from X-User-* headers."""
        from app.config import Settings

        monkeypatch.setattr(
            "app.routers.deps.get_settings",
            lambda: Settings(trust_proxy_headers=True),
        )

        from starlette.requests import Request

        scope = {
            "type": "http",
            "headers": [
                (b"x-user-id", b"proxy-user-id"),
                (b"x-org-id", b"proxy-org-id"),
                (b"x-user-email", b"proxy@test.com"),
            ],
        }
        request = Request(scope)

        user = await get_current_user(request)

        assert user.id == "proxy-user-id"
        assert user.org_id == "proxy-org-id"
        assert user.email == "proxy@test.com"

    async def test_ignores_proxy_headers_when_trust_disabled(self, monkeypatch):
        """With TRUST_PROXY_HEADERS=false (default), should ignore headers."""
        from app.config import Settings

        monkeypatch.setattr(
            "app.routers.deps.get_settings",
            lambda: Settings(trust_proxy_headers=False),
        )

        from starlette.requests import Request

        scope = {
            "type": "http",
            "headers": [
                (b"x-user-id", b"attacker-id"),
                (b"x-org-id", b"attacker-org"),
            ],
        }
        request = Request(scope)

        user = await get_current_user(request)

        # Should fall back to contextvar, not attacker headers
        assert user.id == USER_1
        assert user.org_id == ORG_1

    async def test_dev_no_org_ignores_proxy_org_header_and_resolves_owned_org(
        self, monkeypatch, db_session: AsyncSession
    ):
        """DEV_NO_ORG=true: X-Org-Id is ignored; org resolved from DB by created_by."""
        from app.config import Settings
        from app.repositories.metadata import OrganizationRecord

        monkeypatch.setattr(
            "app.routers.deps.get_settings",
            lambda: Settings(trust_proxy_headers=True, dev_no_org=True),
        )
        db_session.add(OrganizationRecord(id=ORG_1, name="Owned Org", created_by=USER_1))
        await db_session.commit()

        from starlette.requests import Request

        scope = {
            "type": "http",
            "headers": [
                (b"x-user-id", USER_1.encode()),
                (b"x-org-id", b"proxy-org-id"),
                (b"x-user-email", b"proxy@test.com"),
            ],
        }
        request = Request(scope)

        user = await get_current_user(request, db_session)

        assert user.id == USER_1
        assert user.org_id == ORG_1  # resolved from DB, header claim ignored

    async def test_dev_no_org_ignores_contextvar_org_claim_and_resolves_owned_org(
        self, monkeypatch, db_session: AsyncSession
    ):
        """DEV_NO_ORG=true: contextvar org claim is ignored too; identity is consistent."""
        from app.config import Settings
        from app.repositories.metadata import OrganizationRecord

        monkeypatch.setattr(
            "app.routers.deps.get_settings",
            lambda: Settings(dev_no_org=True),
        )
        # Contextvar user (autouse fixture) claims ORG_1; the DB says the user owns ORG_OTHER.
        db_session.add(OrganizationRecord(id=ORG_OTHER, name="Owned Org", created_by=USER_1))
        await db_session.commit()

        from starlette.requests import Request

        request = Request({"type": "http", "headers": []})

        user = await get_current_user(request, db_session)

        assert user.id == USER_1
        assert user.org_id == ORG_OTHER  # resolved from DB, contextvar claim ignored

    async def test_dev_no_org_yields_none_org_when_user_owns_no_org(
        self, monkeypatch, db_session: AsyncSession
    ):
        """DEV_NO_ORG=true: an org-less principal gets org_id None (drives onboarding)."""
        from app.config import Settings

        monkeypatch.setattr(
            "app.routers.deps.get_settings",
            lambda: Settings(trust_proxy_headers=True, dev_no_org=True),
        )

        from starlette.requests import Request

        scope = {
            "type": "http",
            "headers": [
                (b"x-user-id", USER_1.encode()),
                (b"x-org-id", b"proxy-org-id"),
            ],
        }
        request = Request(scope)

        user = await get_current_user(request, db_session)

        assert user.id == USER_1
        assert user.org_id is None


class TestAuthorizeProjectAccess:
    """authorize_project_access verifies org ownership."""

    async def test_allows_access_when_org_matches(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_1, name="My Project", org_id=ORG_1))
        await db_session.commit()

        user, project = await authorize_project_access(project_id=PROJECT_1, user=TEST_USER, db=db_session)

        assert user.id == USER_1
        assert project["id"] == PROJECT_1

    async def test_denies_access_when_org_mismatch(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other", org_id=ORG_OTHER))
        await db_session.commit()

        with pytest.raises(AuthorizationError, match="Access denied"):
            await authorize_project_access(project_id=PROJECT_OTHER, user=TEST_USER, db=db_session)

    async def test_raises_not_found_for_missing_project(self, db_session: AsyncSession):
        set_session(db_session)

        with pytest.raises(ProjectNotFound):
            await authorize_project_access(project_id="nonexistent", user=TEST_USER, db=db_session)

    async def test_allows_access_when_project_has_no_org(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_1, name="Legacy"))
        await db_session.commit()

        _user, project = await authorize_project_access(project_id=PROJECT_1, user=TEST_USER, db=db_session)

        assert project["id"] == PROJECT_1


class TestAuthorizeDatasetAccess:
    """authorize_dataset_access verifies org ownership via parent project."""

    async def test_allows_access_when_org_matches(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_1, name="My Project", org_id=ORG_1))
        db_session.add(DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="DS"))
        await db_session.commit()

        user, dataset = await authorize_dataset_access(dataset_id=DATASET_1, user=TEST_USER, db=db_session)

        assert user.id == USER_1
        assert dataset["id"] == DATASET_1
        assert dataset["project_id"] == PROJECT_1

    async def test_denies_access_when_org_mismatch(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_OTHER, name="Other", org_id=ORG_OTHER))
        db_session.add(DatasetRecord(id=DATASET_OTHER, project_id=PROJECT_OTHER, name="DS"))
        await db_session.commit()

        with pytest.raises(AuthorizationError, match="Access denied"):
            await authorize_dataset_access(dataset_id=DATASET_OTHER, user=TEST_USER, db=db_session)

    async def test_raises_not_found_for_missing_dataset(self, db_session: AsyncSession):
        set_session(db_session)

        with pytest.raises(DatasetNotFound):
            await authorize_dataset_access(dataset_id="nonexistent", user=TEST_USER, db=db_session)

    async def test_allows_access_when_project_has_no_org(self, db_session: AsyncSession):
        set_session(db_session)
        db_session.add(ProjectRecord(id=PROJECT_1, name="Legacy"))
        db_session.add(DatasetRecord(id=DATASET_1, project_id=PROJECT_1, name="DS"))
        await db_session.commit()

        _user, dataset = await authorize_dataset_access(dataset_id=DATASET_1, user=TEST_USER, db=db_session)

        assert dataset["id"] == DATASET_1


class TestAuthorizationErrorHandler:
    """The global exception handler should return 403 for AuthorizationError."""

    async def test_authorization_error_returns_403(self):
        from app.main import authorization_error_handler

        exc = AuthorizationError("Test access denied")
        response = await authorization_error_handler(None, exc)

        assert response.status_code == 403
        import json

        body = json.loads(response.body)
        assert body["errors"][0]["status"] == "403"
        assert body["errors"][0]["title"] == "Forbidden"
        assert "Test access denied" in body["errors"][0]["detail"]


class TestDomainExceptionHandler:
    """Global handler maps DomainException (raised anywhere in the request
    pipeline -- deps, use cases, route handlers) to a structured Problem-
    Details-shaped HTTP response.

    Pre-fix, exceptions raised inside a FastAPI ``Depends(...)`` (e.g.
    ``authorize_project_access`` raising ``ProjectNotFound``) bypassed the
    per-route ``match Failure(error)`` block and bubbled to FastAPI's
    default handler -> opaque 500. The global handler closes that gap so
    every domain exception surfaces with its declared status code and
    metadata.
    """

    async def test_project_not_found_returns_404_with_structured_body(self):
        """ProjectNotFound._status_code is 404; the handler must honour it
        and emit ``{type, title, status, detail}`` matching the shape the
        per-route ``match Failure(error)`` block already produces."""
        from app.main import domain_exception_handler

        exc = ProjectNotFound("missing-id")
        response = await domain_exception_handler(None, exc)

        assert response.status_code == 404
        import json

        body = json.loads(response.body)
        assert body["type"] == "PROJECT_NOT_FOUND"
        assert body["title"] == "Project Not Found"
        assert body["status"] == 404
        assert "missing-id" in body["detail"]

    async def test_handler_honours_subclass_status_code(self):
        """The handler reads ``_status_code`` off the concrete exception,
        so a 400 subclass (ProjectIdRequired) yields 400, not 500."""
        from app.main import domain_exception_handler
        from app.use_cases.project.exceptions import ProjectIdRequired

        exc = ProjectIdRequired()
        response = await domain_exception_handler(None, exc)

        assert response.status_code == 400
        import json

        body = json.loads(response.body)
        assert body["type"] == "PROJECT_ID_REQUIRED"
        assert body["status"] == 400
