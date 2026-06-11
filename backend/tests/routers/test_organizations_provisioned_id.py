"""Router-level wiring tests for the trust-gated X-Provisioned-Org-Id header.

ADR-050 §b: ``POST /api/orgs`` honours the WorkOS-minted ``X-Provisioned-Org-Id``
request header as the persisted org ROW id — but ONLY when the existing
``trust_proxy_headers`` gate is on. Headers are never trusted without the gate
(ADR-016 headers-not-bodies posture). This is the port-to-port wiring defense
for the provisioned-id path (no dev-path acceptance scenario sends the header).

These tests exercise the full ASGI stack (middleware -> router -> controller ->
use case) against the in-memory test session, so the persisted id is read back
straight off the 201 JSON:API response — no DB peek needed.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.database import get_db
from app.main import app

# A user with NO org so ``_ensure_user_has_no_org`` passes: X-Org-Id is omitted
# so the resolved principal carries org_id=None.
IDENTITY_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-User-Email": "dev@localhost",
}
PROVISIONED_ID = "org_workos_provisioned_99"


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


async def test_post_orgs_honours_provisioned_id_when_trust_on(client: AsyncClient, trust_proxy_headers_on):
    """Header present + trust ON → the persisted org id == the header value."""
    async with client:
        res = await client.post(
            "/api/orgs",
            json={"name": "Provisioned Wiring Org"},
            headers={**IDENTITY_HEADERS, "X-Provisioned-Org-Id": PROVISIONED_ID},
        )

    assert res.status_code == 201, res.text
    assert res.json()["data"]["id"] == PROVISIONED_ID


async def test_post_orgs_ignores_provisioned_id_when_trust_off(client: AsyncClient):
    """Header present but trust OFF (default) → header IGNORED, generated id.

    This is the arm that proves the gate actually gates: the same header that
    would be honoured above is dropped on the floor without the trust flag.
    """
    async with client:
        res = await client.post(
            "/api/orgs",
            json={"name": "Untrusted Header Org"},
            headers={**IDENTITY_HEADERS, "X-Provisioned-Org-Id": PROVISIONED_ID},
        )

    assert res.status_code == 201, res.text
    assert res.json()["data"]["id"] != PROVISIONED_ID
