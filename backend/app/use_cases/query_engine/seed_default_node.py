"""Seed a default query engine node on backend startup."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...config import get_settings
from ...repositories.metadata.query_engine_node_record import QueryEngineNodeRecord

logger = logging.getLogger(__name__)


async def seed_default_query_engine_node(session: AsyncSession, org_id: str) -> None:
    """Create the default query engine node if it doesn't exist for the given org.

    Reads connection details from settings. Idempotent — skips if a node
    with the same (org_id, name) already exists.
    """
    settings = get_settings()

    result = await session.execute(
        select(QueryEngineNodeRecord).where(
            QueryEngineNodeRecord.org_id == org_id,
            QueryEngineNodeRecord.name == settings.query_engine_name,
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        logger.info(
            "Query engine node '%s' already exists for org %s (status: %s)",
            settings.query_engine_name,
            org_id,
            existing.status,
        )
        return

    node = QueryEngineNodeRecord(
        org_id=org_id,
        name=settings.query_engine_name,
        host=settings.query_engine_host,
        port=settings.query_engine_port,
        database=settings.query_engine_database,
        admin_user=settings.query_engine_admin_user,
        admin_password_encrypted=settings.query_engine_admin_password,
        status="running",
    )
    session.add(node)
    await session.commit()
    logger.info(
        "Seeded default query engine node '%s' for org %s at %s:%d",
        settings.query_engine_name,
        org_id,
        settings.query_engine_host,
        settings.query_engine_port,
    )
