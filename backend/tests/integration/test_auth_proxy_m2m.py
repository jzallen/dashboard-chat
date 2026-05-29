"""Backend-side integration test for the dev-mode M2M flow.

Auth-proxy mints M2M tokens (A.1) and, in AUTH_MODE=dev, ships a built-in
synthetic client (A.2) whose identity matches backend's DEV_USER. Auth-proxy
then forwards the issued identity as `X-User-Id` / `X-Org-Id` /
`X-User-Email` headers to backend, which runs as a pure resource server
(ADR-016 / ADR-043): it trusts those headers and never verifies JWTs itself.

This test exercises the receiving half of that flow: when the headers
auth-proxy emits for the dev built-in M2M client arrive at the backend, the
auth user the ACL (`get_current_user`) resolves must be DEV_USER, and a
protected route must accept them. The auth-proxy half (mint -> bearer ->
forwarded headers) is covered in
`auth-proxy/m2m-issuance.test.ts::M2M issuance — dev-mode parity`.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from app.auth import DEV_USER
from app.main import app
from app.routers.deps import get_current_user

# Identity values that auth-proxy's built-in dev M2M client mints for.
# Mirrors auth-proxy/lib/m2m.ts::DEV_BUILTIN_CLIENT — keep in sync.
PROXY_DEV_M2M_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-Org-Id": "dev-org-001",
    "X-User-Email": "dev@localhost",
}


def _request_with_headers(headers: dict[str, str]) -> Request:
    """Build a minimal Starlette Request carrying the given headers."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/projects",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
    }
    return Request(scope)


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestDevMintedM2mTokenReachesBackend:
    """Backend accepts auth-proxy's forwarded identity for a dev-minted M2M token."""

    async def test_dev_m2m_headers_resolve_to_dev_user(self):
        """The ACL resolves auth-proxy's dev-built-in headers to DEV_USER."""
        user = await get_current_user(_request_with_headers(PROXY_DEV_M2M_HEADERS))

        assert user.id == DEV_USER.id  # dev-user-001
        assert user.org_id == DEV_USER.org_id  # dev-org-001
        assert user.email == DEV_USER.email  # dev@localhost

    async def test_dev_m2m_headers_pass_authentication_for_protected_route(self, client: AsyncClient):
        """A protected route does not 401 when given dev-mint proxy headers."""
        async with client:
            res = await client.get("/api/projects", headers=PROXY_DEV_M2M_HEADERS)

        # Auth layer accepts the headers. Downstream code may return non-2xx for
        # other reasons (e.g. empty DB), but it must not be a 401 from auth.
        assert res.status_code != 401, res.text

    async def test_unauthenticated_request_without_identity_headers_is_rejected(self, client: AsyncClient):
        """The resource server rejects a request carrying no identity headers."""
        async with client:
            res = await client.get("/api/projects")

        assert res.status_code == 401
