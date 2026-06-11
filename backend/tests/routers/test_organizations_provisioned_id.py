"""Router-level wiring tests for the org-id carry on ``POST /api/orgs``.

ADR-050 §b (post-cleanup): the new org's ROW id is the caller's org claim
(``user.org_id`` ← ``X-Org-Id``) — in workos mode the auth-proxy sets
``X-Org-Id`` to the freshly-provisioned WorkOS org id on the create-route
forward. There is no longer a separate ``X-Provisioned-Org-Id`` header.

The trust boundary lives entirely in the auth-proxy's strip-then-inject (a
client-supplied ``X-Org-Id`` is dropped on every route and replaced with the
verified value — tested in the auth-proxy suite). The backend therefore trusts
the ``X-Org-Id`` it receives (the ``AuthMiddleware`` reads it into the auth
contextvar unconditionally), and persists it verbatim as the row id.

This test exercises the full ASGI stack (middleware -> router -> controller ->
use case) against the in-memory test session, so the persisted id is read back
straight off the 201 JSON:API response — no DB peek needed.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import get_db
from app.main import app

IDENTITY_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-User-Email": "dev@localhost",
}
# The provisioned WorkOS org id the auth-proxy injects as X-Org-Id on the
# create-route forward; the backend persists it verbatim as the row id.
CLAIMED_ORG_ID = "org_workos_provisioned_99"


@pytest.fixture
def client(db_session):
    """ASGI client whose get_db dependency yields the in-memory test session.

    ASGITransport does not run the app lifespan, so the real (Postgres) engine
    is never initialised — the override routes all persistence through the
    rolled-back SQLite session from the shared db_session fixture.
    """

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    yield AsyncClient(transport=transport, base_url="http://test")
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def trust_proxy_headers_on(monkeypatch):
    """Force ``trust_proxy_headers`` ON for the duration of the test.

    ``get_settings`` is lru_cached and the route reads it at request time, so
    clearing the cache before the request is the cleanest toggle; the cache is
    cleared again on teardown to restore the default-OFF env for other tests.
    """
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_post_orgs_persists_org_id_claim_as_row_id(client: AsyncClient, trust_proxy_headers_on):
    """The X-Org-Id claim becomes the persisted org ROW id verbatim — the WorkOS
    org id IS the local org id (ADR-050 §b)."""
    async with client:
        res = await client.post(
            "/api/orgs",
            json={"name": "Provisioned Wiring Org"},
            headers={**IDENTITY_HEADERS, "X-Org-Id": CLAIMED_ORG_ID},
        )

    assert res.status_code == 201, res.text
    assert res.json()["data"]["id"] == CLAIMED_ORG_ID
