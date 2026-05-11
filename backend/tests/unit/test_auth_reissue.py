"""Unit tests for POST /api/auth/reissue (UI-1 / ADR-029 invariant 4).

Behavior budget: 1 distinct behavior under test (re-mint JWT with org_id).
Variations of that behavior (happy path, missing auth, empty org_id, non-dev
provider) are parametrized over a single per-case integration around the
driving port (`POST /api/auth/reissue` through a FastAPI TestClient).
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import jwt
import pytest
from fastapi import FastAPI

from app.auth import set_auth_user
from app.auth.dev_keys import get_public_key
from app.auth.dev_provider import DEV_USER, DevAuthProvider
from app.routers.auth import router


@pytest.fixture
def app() -> FastAPI:
    """Minimal FastAPI app with just the auth router."""
    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


@pytest.fixture
async def client(app: FastAPI):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest.fixture(autouse=True)
def _set_dev_user_in_context():
    """Set the auth context to DEV_USER for the duration of each test.

    Production flows set this in middleware; tests bypass middleware so we
    seed it directly.
    """
    set_auth_user(DEV_USER)
    yield


@pytest.fixture(autouse=True)
def _use_dev_provider():
    """Patch the provider lookup so /reissue takes the DevAuthProvider branch."""
    with patch("app.routers.auth.get_auth_provider", return_value=DevAuthProvider()):
        yield


class TestReissueEndpoint:
    """Tests for POST /api/auth/reissue."""

    async def test_reissues_jwt_carrying_supplied_org_id(self, client):
        """Happy path: returns access_token whose org_id claim equals body.org_id."""
        new_org_id = "org_acme_data_123"
        resp = await client.post("/api/auth/reissue", json={"org_id": new_org_id})

        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["access_token"].count(".") == 2
        assert data["expires_in"] == 300

        # Decode the JWT and confirm the org_id claim equals what we requested.
        decoded = jwt.decode(
            data["access_token"],
            get_public_key(),
            algorithms=["RS256"],
            audience="dev-client",
            issuer="http://localhost:8000",
        )
        assert decoded["org_id"] == new_org_id
        assert decoded["sub"] == DEV_USER.id

    async def test_idempotent_for_repeated_calls_with_same_org_id(self, client):
        """Repeated calls with the same org_id MUST return fresh tokens carrying that org_id.

        Idempotency here means observable contract: every call yields a usable
        token with the requested claim. We do NOT require token-byte equality
        across calls (the timestamp claim moves).
        """
        org_id = "org_acme_data_123"
        first = await client.post("/api/auth/reissue", json={"org_id": org_id})
        second = await client.post("/api/auth/reissue", json={"org_id": org_id})

        assert first.status_code == 200
        assert second.status_code == 200
        for resp in (first, second):
            decoded = jwt.decode(
                resp.json()["access_token"],
                get_public_key(),
                algorithms=["RS256"],
                audience="dev-client",
                issuer="http://localhost:8000",
            )
            assert decoded["org_id"] == org_id

    @pytest.mark.parametrize(
        "body,expected_status",
        [
            ({"org_id": ""}, 400),  # empty string
            ({"org_id": "   "}, 400),  # whitespace-only
            ({}, 422),  # pydantic validation (missing field)
        ],
    )
    async def test_rejects_invalid_request(self, client, body, expected_status):
        resp = await client.post("/api/auth/reissue", json=body)
        assert resp.status_code == expected_status

    async def test_returns_401_without_auth_context(self, app):
        """When there's no auth user in context, the endpoint must return 401.

        Bypasses the autouse `_set_dev_user_in_context` fixture by clearing
        context inside the request handler scope.
        """
        from app.auth import clear_auth_user

        clear_auth_user()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            resp = await c.post("/api/auth/reissue", json={"org_id": "any"})
        assert resp.status_code == 401

    async def test_returns_501_for_workos_provider(self, client):
        """WorkOS reissue not yet implemented — must surface a clear 501 not a 500."""
        from app.auth.workos_provider import WorkOSAuthProvider

        # Construct a workos provider without hitting the real WorkOS API
        with patch(
            "app.routers.auth.get_auth_provider",
            return_value=WorkOSAuthProvider.__new__(WorkOSAuthProvider),
        ):
            resp = await client.post("/api/auth/reissue", json={"org_id": "any"})
        assert resp.status_code == 501
