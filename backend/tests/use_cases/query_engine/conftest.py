import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata.query_engine_node_record import QueryEngineNodeRecord
from tests.uuidv7_fixtures import ORG_1, USER_1

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all query engine tests."""
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with query engine nodes."""
    node1 = QueryEngineNodeRecord(
        id="019515a0-8001-7000-8000-000000000081",
        org_id=ORG_1,
        name="Production Engine",
        host="pg-prod.example.com",
        port=5432,
        database="analytics",
        admin_user="admin",
        admin_password_encrypted="encrypted-pw-1",
        status="active",
    )
    node2 = QueryEngineNodeRecord(
        id="019515a0-8002-7000-8000-000000000082",
        org_id=ORG_1,
        name="Staging Engine",
        host="pg-staging.example.com",
        port=5432,
        database="analytics_staging",
        admin_user="admin",
        admin_password_encrypted="encrypted-pw-2",
        status="pending",
    )
    db_session.add(node1)
    db_session.add(node2)
    await db_session.commit()

    return db_session
