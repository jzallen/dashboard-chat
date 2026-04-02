from returns.result import Failure, Success

from app.repositories import set_session
from app.use_cases.query_engine.get_query_engine import get_query_engine
from tests.uuidv7_fixtures import ORG_1

NODE_1_ID = "019515a0-8001-7000-8000-000000000081"
NODE_NONEXISTENT = "019515a0-8099-7000-8000-000000000099"
OTHER_ORG_ID = "019515a0-4001-7000-8000-000000000099"


async def test_get_query_engine_returns_detail(seeded_db):
    """Should return engine detail with connection strings."""
    set_session(seeded_db)
    result = await get_query_engine(NODE_1_ID, ORG_1)

    assert isinstance(result, Success)
    data = result.unwrap()
    assert data["id"] == NODE_1_ID
    assert data["name"] == "Production Engine"
    assert data["host"] == "pg-prod.example.com"
    assert data["port"] == 5432
    assert data["database"] == "analytics"
    assert data["project_count"] == 0

    # Connection strings
    cs = data["connection_strings"]
    assert cs["postgresql"] == "postgresql://pg-prod.example.com:5432/analytics"
    assert "jdbc:postgresql://pg-prod.example.com:5432/analytics" in cs["jdbc"]
    assert "pg-prod.example.com" in cs["odbc"]


async def test_get_query_engine_not_found(seeded_db):
    """Should return Failure when engine doesn't exist."""
    set_session(seeded_db)
    result = await get_query_engine(NODE_NONEXISTENT, ORG_1)

    assert isinstance(result, Failure)
    assert isinstance(result.failure(), ValueError)
    assert "not found" in str(result.failure())


async def test_get_query_engine_wrong_org(seeded_db):
    """Should return Failure when engine belongs to another org (IDOR protection)."""
    set_session(seeded_db)
    result = await get_query_engine(NODE_1_ID, OTHER_ORG_ID)

    assert isinstance(result, Failure)
    assert isinstance(result.failure(), ValueError)
    assert "not found" in str(result.failure())


async def test_get_query_engine_excludes_password(seeded_db):
    """Should not expose admin_password_encrypted in the result."""
    set_session(seeded_db)
    result = await get_query_engine(NODE_1_ID, ORG_1)

    assert isinstance(result, Success)
    data = result.unwrap()
    assert "admin_password_encrypted" not in data
