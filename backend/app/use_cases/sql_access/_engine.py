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


async def resolve_engine_node_for_org(
    org_id: str, repos: "RepositoryContainer"
) -> "QueryEngineNodeView":
    """Return the org's default query engine node, or raise if none exists.

    Looks up the first (default) engine node assigned to the given org via
    the repository container. Callers invoke this before provisioning so a
    missing engine-node assignment surfaces as a RuntimeError rather than
    a downstream attribute error.
    """
    node = await repos.query_engine_node.get_first_for_org(org_id)
    if not node:
        raise RuntimeError(f"No query engine node found for org '{org_id}'")
    return node
