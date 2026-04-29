"""Backend-side integration test for the dev-mode M2M flow.

Auth-proxy mints M2M tokens (A.1) and, in AUTH_MODE=dev, ships a built-in
synthetic client (A.2) whose identity matches backend's DEV_USER. Auth-proxy
then forwards the issued identity as `X-User-Id` / `X-Org-Id` /
`X-User-Email` headers to backend, which runs with `TRUST_PROXY_HEADERS=true`
in the dev compose stack and the api-driven test stack (ADR-016).

This test exercises the receiving half of that flow: when the headers
auth-proxy emits for the dev built-in M2M client arrive at the backend, the
auth user observed by route handlers must be DEV_USER. The auth-proxy half
(mint → bearer → forwarded headers) is covered in
`auth-proxy/m2m-issuance.test.ts::M2M issuance — dev-mode parity`.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.dev_provider import DEV_USER
from app.config import Settings
from app.main import app

# Identity values that auth-proxy's built-in dev M2M client mints for.
# Mirrors auth-proxy/lib/m2m.ts::DEV_BUILTIN_CLIENT — keep in sync.
PROXY_DEV_M2M_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-Org-Id": "dev-org-001",
    "X-User-Email": "dev@localhost",
}


@pytest.fixture
def trust_proxy_headers(monkeypatch):
    """Run the backend as if it sits behind auth-proxy with header trust on."""
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: Settings(trust_proxy_headers=True),
    )


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestDevMintedM2mTokenReachesBackend:
    """Backend accepts auth-proxy's forwarded identity for a dev-minted M2M token."""

    async def test_dev_m2m_headers_authenticate_request_as_dev_user(
        self, client: AsyncClient, trust_proxy_headers: None
    ):
        """Headers auth-proxy emits for the dev built-in client identify the request as DEV_USER."""
        async with client:
            res = await client.get("/api/auth/me", headers=PROXY_DEV_M2M_HEADERS)

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["id"] == DEV_USER.id  # dev-user-001
        assert body["org_id"] == DEV_USER.org_id  # dev-org-001
        assert body["email"] == DEV_USER.email  # dev@localhost

    async def test_dev_m2m_headers_pass_authentication_for_protected_route(
        self, client: AsyncClient, trust_proxy_headers: None
    ):
        """A protected route does not 401 when given dev-mint proxy headers."""
        async with client:
            res = await client.get("/api/projects", headers=PROXY_DEV_M2M_HEADERS)

        # Auth layer accepts the headers. Downstream code may return non-2xx for
        # other reasons (e.g. empty DB), but it must not be a 401 from auth.
        assert res.status_code != 401, res.text

    async def test_legacy_dev_token_static_path_still_works_without_proxy(self, client: AsyncClient):
        """Pre-A.1 dev flow (RS256 dev JWT, no proxy headers) is unchanged.

        Exit criterion 4: no regression in existing dev-mode auth.
        """
        from app.auth.dev_provider import _mint_jwt

        token = _mint_jwt()
        async with client:
            res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["id"] == DEV_USER.id

    async def test_unauthenticated_request_without_headers_or_token_is_rejected(
        self, client: AsyncClient, trust_proxy_headers: None
    ):
        """Trust-proxy mode must still reject requests with neither headers nor token."""
        async with client:
            res = await client.get("/api/auth/me")

        # /api/auth/me handles auth via the contextvar — middleware sees no
        # X-User-Id and falls through to Bearer-token verification, which
        # fails with 401 because there's no Authorization header.
        assert res.status_code == 401
