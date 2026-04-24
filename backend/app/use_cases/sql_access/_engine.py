"""Shared engine-node helpers for SQL access use cases."""

from typing import TYPE_CHECKING

from app.use_cases.sql_access.exceptions import QueryEngineUnreachable

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer
    from app.repositories.query_engine_node import QueryEngineNodeView


async def ensure_engine_reachable(engine_node, provisioner) -> None:
    """Raise QueryEngineUnreachable if the provisioner reports the node unhealthy.

    Performs a health check against the shared query engine node. Callers
    invoke this before performing provisioning work so failures surface
    with a domain-specific exception instead of a downstream DB error.
    """
    if not await provisioner.health_check(engine_node.id):
        raise QueryEngineUnreachable(engine_node.id)


async def resolve_engine_node_by_id(
    engine_node_id: str,
    repos: "RepositoryContainer",
    *,
    fallback_to_settings: bool = False,
) -> "QueryEngineNodeView | None":
    """Return the engine node with the given id.

    When ``fallback_to_settings`` is False (default), raises RuntimeError
    if no node exists for the id - matches regenerate_sql_credentials
    policy. When True, returns None and lets the caller fall back to
    settings-derived defaults - matches get_sql_access policy.
    """
    engine_node = await repos.query_engine_node.get_by_id(engine_node_id)
    if engine_node is None and not fallback_to_settings:
        raise RuntimeError(f"Engine node '{engine_node_id}' not found")
    return engine_node
