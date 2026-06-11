"""Router-level wiring tests for GET /api/orgs/availability (CDO-S2, ADR-050 §b).

Supporting affordance (ADR-048 layer A): a bare ``{"available": bool}`` body
over the existing ``get_organization_by_name`` point lookup, behind the same
identity-header auth as the other org routes. No dev-path acceptance scenario
calls this route (the CDO-S5 auth-proxy interception is its only consumer), so
this ASGI test is the port-to-port wiring defense.

The full stack is exercised (middleware -> router -> controller -> use case)
against the in-memory test session via the get_db override, so a freshly-seeded
org name is read back as taken straight off the response.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.repositories.metadata import OrganizationRecord

# A user with NO org; X-Org-Id omitted so the resolved principal carries
# org_id=None. Availability does not require an org, only an authenticated user.
IDENTITY_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-User-Email": "dev@localhost",
}


@pytest.fixture
def client(db_session):
    """ASGI client whose get_db dependency yields the in-memory test session."""

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    yield AsyncClient(transport=transport, base_url="http://test")
    app.dependency_overrides.pop(get_db, None)


async def test_availability_true_for_free_name(client: AsyncClient):
    """A name with no matching org row → 200 {"available": true}."""
    async with client:
        res = await client.get(
            "/api/orgs/availability",
            params={"name": "Unclaimed Co"},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    assert res.json() == {"available": True}


async def test_availability_false_for_taken_name(client: AsyncClient, db_session):
    """A name already persisted → 200 {"available": false}."""
    db_session.add(OrganizationRecord(name="Taken Org Inc"))
    await db_session.flush()

    async with client:
        res = await client.get(
            "/api/orgs/availability",
            params={"name": "Taken Org Inc"},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    assert res.json() == {"available": False}
