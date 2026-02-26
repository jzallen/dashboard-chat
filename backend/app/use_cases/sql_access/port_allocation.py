"""Port allocation for PgBouncer proxy containers."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.repositories.metadata.external_access_record import ExternalAccessRecord


class PortRangeExhausted(Exception):
    """Raised when no ports are available in the configured range."""

    pass


async def allocate_proxy_port(session: AsyncSession) -> int:
    """Find the next available port in the configured PgBouncer port range.

    Queries all non-null environment_port values from ExternalAccessRecord
    and returns the first unused port in the range.
    """
    settings = get_settings()

    result = await session.execute(
        select(ExternalAccessRecord.environment_port).where(
            ExternalAccessRecord.environment_port.isnot(None)
        )
    )
    used_ports = {row[0] for row in result}

    for port in range(
        settings.pgbouncer_port_range_start, settings.pgbouncer_port_range_end + 1
    ):
        if port not in used_ports:
            return port

    raise PortRangeExhausted(
        f"No available ports in range "
        f"{settings.pgbouncer_port_range_start}-{settings.pgbouncer_port_range_end}"
    )
