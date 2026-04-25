"""Test fixtures for SQL access use cases."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import clear_auth_user, set_auth_user
from app.auth.types import AuthUser
from app.repositories.metadata import DatasetRecord, ProjectRecord
from app.repositories.metadata.external_access_record import ExternalAccessRecord
from app.repositories.metadata.query_engine_node_record import QueryEngineNodeRecord
from app.use_cases.sql_access._infra import (
    MockQueryEngineProvisioner,
    set_app_query_engine_provisioner,
)
from tests.uuidv7_fixtures import (
    DATASET_1,
    DATASET_2,
    DATASET_OTHER,
    EA_1,
    EA_DISABLED,
    ENGINE_NODE_1,
    ORG_1,
    ORG_OTHER,
    PROJECT_1,
    PROJECT_EMPTY,
    PROJECT_OTHER,
    USER_1,
)

TEST_USER = AuthUser(id=USER_1, email="test@example.com", org_id=ORG_1, name="Test User")


@pytest.fixture(autouse=True)
def auth_user():
    """Set a default auth user for all SQL access tests."""
    set_auth_user(TEST_USER)
    yield
    clear_auth_user()


@pytest.fixture(autouse=True)
def mock_query_engine_provisioner():
    """Set a mock query engine provisioner for all SQL access tests."""
    provisioner = MockQueryEngineProvisioner()
    set_app_query_engine_provisioner(provisioner)
    yield provisioner
    set_app_query_engine_provisioner(None)  # type: ignore[arg-type]


@pytest.fixture
async def seeded_db(db_session: AsyncSession):
    """Seed the database with an engine node, project, and two datasets."""
    # Engine node (parent)
    node = QueryEngineNodeRecord(
        id=ENGINE_NODE_1,
        org_id=ORG_1,
        name="default",
        host="query-engine",
        port=5432,
        database="dashboard_external",
        admin_user="duckdb_admin",
        admin_password_encrypted="encrypted-secret",
        status="active",
    )
    db_session.add(node)

    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        description="A test project",
        org_id=ORG_1,
    )
    db_session.add(project)
    await db_session.flush()

    dataset1 = DatasetRecord(
        id=DATASET_1,
        project_id=PROJECT_1,
        name="Dataset One",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    dataset2 = DatasetRecord(
        id=DATASET_2,
        project_id=PROJECT_1,
        name="Dataset Two",
        schema_config={"fields": {"col2": {"type": "number"}}},
    )
    db_session.add(dataset1)
    db_session.add(dataset2)

    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_with_access(seeded_db: AsyncSession):
    """Seed with enabled external access record linked to engine node."""
    record = ExternalAccessRecord(
        id=EA_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        engine_node_id=ENGINE_NODE_1,
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_proxy_role="proxy_project_",
        pg_password_hash="md5abcdef1234567890abcdef12345678",
        enabled=True,
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_with_disabled_access(seeded_db: AsyncSession):
    """Seed with disabled external access record."""
    record = ExternalAccessRecord(
        id=EA_DISABLED,
        project_id=PROJECT_1,
        org_id=ORG_1,
        engine_node_id=ENGINE_NODE_1,
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_proxy_role="proxy_project_",
        pg_password_hash="md5abcdef1234567890abcdef12345678",
        enabled=False,
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_no_datasets(db_session: AsyncSession):
    """Seed with an engine node and project that has no datasets."""
    node = QueryEngineNodeRecord(
        id=ENGINE_NODE_1,
        org_id=ORG_1,
        name="default",
        host="query-engine",
        port=5432,
        database="dashboard_external",
        admin_user="duckdb_admin",
        admin_password_encrypted="encrypted-secret",
        status="active",
    )
    db_session.add(node)

    project = ProjectRecord(
        id=PROJECT_EMPTY,
        name="Empty Project",
        org_id=ORG_1,
    )
    db_session.add(project)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_other_org(db_session: AsyncSession):
    """Seed with a project owned by a different org."""
    project = ProjectRecord(
        id=PROJECT_OTHER,
        name="Other Org Project",
        org_id=ORG_OTHER,
    )
    db_session.add(project)

    dataset = DatasetRecord(
        id=DATASET_OTHER,
        project_id=PROJECT_OTHER,
        name="Other Dataset",
        schema_config={"fields": {"col1": {"type": "text"}}},
    )
    db_session.add(dataset)
    await db_session.commit()
    return db_session


@pytest.fixture
async def seeded_db_with_access_no_engine_node(seeded_db: AsyncSession):
    """Enabled access record with engine_node_id=None (fallback path).

    Pinned timestamps allow exact assertion of last_synced_at and created_at.
    """
    from datetime import UTC, datetime

    record = ExternalAccessRecord(
        id=EA_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        engine_node_id=None,
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_proxy_role="proxy_project_",
        pg_password_hash="md5abcdef1234567890abcdef12345678",
        enabled=True,
        last_synced_at=datetime(2026, 1, 15, 12, 30, 0, tzinfo=UTC),
        created_at=datetime(2026, 1, 1, 9, 0, 0, tzinfo=UTC),
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_with_access_no_proxy_role(seeded_db: AsyncSession):
    """Enabled access record where pg_proxy_role is None (username falls back to pg_role)."""
    record = ExternalAccessRecord(
        id=EA_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        engine_node_id=ENGINE_NODE_1,
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_proxy_role=None,
        pg_password_hash="md5abcdef1234567890abcdef12345678",
        enabled=True,
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db


@pytest.fixture
async def seeded_db_with_access_pinned_timestamps(seeded_db: AsyncSession):
    """Enabled access record (with engine_node) and explicit timestamps for assertion."""
    from datetime import UTC, datetime

    record = ExternalAccessRecord(
        id=EA_1,
        project_id=PROJECT_1,
        org_id=ORG_1,
        engine_node_id=ENGINE_NODE_1,
        pg_schema="project_project_",
        pg_role="reader_project_",
        pg_proxy_role="proxy_project_",
        pg_password_hash="md5abcdef1234567890abcdef12345678",
        enabled=True,
        last_synced_at=datetime(2026, 2, 20, 14, 0, 0, tzinfo=UTC),
        created_at=datetime(2026, 2, 1, 10, 0, 0, tzinfo=UTC),
    )
    seeded_db.add(record)
    await seeded_db.commit()
    return seeded_db
