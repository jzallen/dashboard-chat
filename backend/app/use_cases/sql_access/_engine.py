"""Shared engine-node helpers for SQL access use cases."""

from app.use_cases.sql_access.exceptions import QueryEngineUnreachable


async def ensure_engine_reachable(engine_node, provisioner) -> None:
    """Raise QueryEngineUnreachable if the provisioner reports the node unhealthy.

    Performs a health check against the shared query engine node. Callers
    invoke this before performing provisioning work so failures surface
    with a domain-specific exception instead of a downstream DB error.
    """
    if not await provisioner.health_check(engine_node.id):
        raise QueryEngineUnreachable(engine_node.id)
