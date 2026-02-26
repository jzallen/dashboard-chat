"""Tests for port allocation for PgBouncer proxy containers."""

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import set_session
from app.repositories.metadata import ExternalAccessRecord
from app.use_cases.sql_access.port_allocation import (
    PortRangeExhausted,
    allocate_proxy_port,
)

from tests.uuidv7_fixtures import ORG_1, PROJECT_1, PROJECT_EMPTY


@pytest.fixture
async def seeded_db_with_ports(db_session: AsyncSession):
    """Seed db with project and external access records that have ports allocated."""
    from app.repositories.metadata import ProjectRecord

    project = ProjectRecord(
        id=PROJECT_1,
        name="Test Project",
        org_id=ORG_1,
    )
    db_session.add(project)

    project_empty = ProjectRecord(
        id=PROJECT_EMPTY,
        name="Empty Project",
        org_id=ORG_1,
    )
    db_session.add(project_empty)
    await db_session.flush()

    # Record with port 6432 (first in range)
    record1 = ExternalAccessRecord(
        project_id=PROJECT_1,
        org_id=ORG_1,
        pg_schema="project_abc",
        pg_role="reader_abc",
        pg_password_hash="$2b$12$fakehash1",
        environment_port=6432,
        enabled=True,
    )
    db_session.add(record1)
    await db_session.commit()
    return db_session


class TestAllocateProxyPort:
    """Tests for allocate_proxy_port."""

    async def test_basic_allocation_returns_first_port(self, db_session: AsyncSession):
        """With no ports used, returns the start of the range."""
        set_session(db_session)
        port = await allocate_proxy_port(db_session)
        assert port == 6432

    async def test_skips_used_ports(
        self, seeded_db_with_ports: AsyncSession
    ):
        """With port 6432 used, returns the next available (6433)."""
        set_session(seeded_db_with_ports)
        port = await allocate_proxy_port(seeded_db_with_ports)
        assert port == 6433

    @patch("app.use_cases.sql_access.port_allocation.get_settings")
    async def test_port_range_exhaustion(
        self, mock_settings, seeded_db_with_ports: AsyncSession
    ):
        """When all ports in range are used, raises PortRangeExhausted."""
        settings = mock_settings.return_value
        # Tiny range: only port 6432, which is already used
        settings.pgbouncer_port_range_start = 6432
        settings.pgbouncer_port_range_end = 6432

        set_session(seeded_db_with_ports)
        with pytest.raises(PortRangeExhausted, match="No available ports in range"):
            await allocate_proxy_port(seeded_db_with_ports)

    async def test_reclaimed_port_becomes_available(
        self, seeded_db_with_ports: AsyncSession
    ):
        """After clearing environment_port (soft_disable), the port is reusable."""
        set_session(seeded_db_with_ports)

        # Clear the port on the existing record (simulates soft_disable)
        from sqlalchemy import select

        result = await seeded_db_with_ports.execute(
            select(ExternalAccessRecord).where(
                ExternalAccessRecord.project_id == PROJECT_1
            )
        )
        record = result.scalar_one()
        record.environment_port = None
        await seeded_db_with_ports.flush()

        # Now port 6432 should be available again
        port = await allocate_proxy_port(seeded_db_with_ports)
        assert port == 6432
