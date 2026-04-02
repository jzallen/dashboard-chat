"""Test connectivity to a query engine node."""

import time

from app.config import get_settings
from app.repositories import with_repositories
from app.use_cases import handle_returns


@with_repositories
@handle_returns
async def test_query_engine_connection(node_id: str, org_id: str, *, repositories=None):
    """Test connectivity to a query engine node via asyncpg.

    Args:
        node_id: Query engine node ID.
        org_id: Organization ID for authorization check.
        repositories: Injected by @with_repositories.

    Returns:
        Dict with status, latency_ms, and optional error.

    Raises:
        ValueError: If node not found or belongs to another org.
    """
    repo = repositories.query_engine_node
    node = await repo.get_by_id(node_id)
    if not node:
        raise ValueError(f"Query engine node {node_id} not found")
    if node.org_id != org_id:
        raise ValueError(f"Query engine node {node_id} not found")

    import asyncpg

    settings = get_settings()
    start = time.monotonic()
    try:
        conn = await asyncpg.connect(
            host=node.host,
            port=node.port,
            database=node.database,
            user=node.admin_user,
            password=settings.query_engine_admin_password,
            timeout=10,
        )
        await conn.fetchval("SELECT 1")
        await conn.close()
        elapsed = time.monotonic() - start
        await repo.update(node_id, {"status": "healthy", "status_message": None})
        return {"status": "success", "latency_ms": round(elapsed * 1000)}
    except Exception as e:
        elapsed = time.monotonic() - start
        await repo.update(node_id, {"status": "unreachable", "status_message": str(e)})
        return {"status": "failure", "error": str(e), "latency_ms": round(elapsed * 1000)}
