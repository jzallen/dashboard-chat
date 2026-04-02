"""List query engine nodes for an organization."""

from app.repositories import with_repositories
from app.use_cases import handle_returns


@with_repositories
@handle_returns
async def list_query_engines(org_id: str, *, repositories=None):
    """List all query engine nodes for the given organization.

    Args:
        org_id: Organization ID to list engines for.
        repositories: Injected by @with_repositories.

    Returns:
        List of QueryEngineNodeView dataclasses.
    """
    repo = repositories.query_engine_node
    return await repo.list_by_org(org_id)
