"""Shared engine-node helpers for SQL access use cases."""

from typing import TYPE_CHECKING

from app.use_cases.sql_access._infra.provisioner import ProjectEnvironment
from app.use_cases.sql_access.exceptions import QueryEngineUnreachable

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer
    from app.repositories.query_engine_node import QueryEngineNodeView


def build_project_environment(engine_node, admin_password: str) -> ProjectEnvironment:
    """Build a ProjectEnvironment from an engine node row + admin password.

    Pure synchronous mapping: copies the connection fields off the engine
    node row and pairs them with the supplied ``admin_password``. The
    optional ``internal_host``, ``internal_port``, and
    ``proxy_container_id`` fields keep their dataclass defaults, matching
    the existing call site in ``regenerate_sql_credentials``.
    """
    return ProjectEnvironment(
        environment_id=engine_node.id,
        host=engine_node.host,
        port=engine_node.port,
        database=engine_node.database,
        admin_user=engine_node.admin_user,
        admin_password=admin_password,
    )


async def ensure_engine_reachable(engine_node, provisioner) -> None:
    """Raise QueryEngineUnreachable if the provisioner reports the node unhealthy.

    Performs a health check against the shared query engine node. Callers
    invoke this before performing provisioning work so failures surface
    with a domain-specific exception instead of a downstream DB error.
    """
    if not await provisioner.health_check(engine_node.id):
        raise QueryEngineUnreachable(engine_node.id)


async def resolve_engine_node_for_org(org_id: str, repos: "RepositoryContainer") -> "QueryEngineNodeView":
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
