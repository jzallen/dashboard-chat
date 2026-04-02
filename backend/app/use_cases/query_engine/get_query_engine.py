"""Get a single query engine node with connection strings."""

from app.repositories import with_repositories
from app.use_cases import handle_returns


@with_repositories
@handle_returns
async def get_query_engine(node_id: str, org_id: str, *, repositories=None):
    """Get a query engine node by ID with connection strings and project count.

    Args:
        node_id: Query engine node ID.
        org_id: Organization ID for authorization check.
        repositories: Injected by @with_repositories.

    Returns:
        Dict with node details and connection strings.

    Raises:
        ValueError: If node not found or belongs to another org.
    """
    repo = repositories.query_engine_node
    node = await repo.get_with_project_count(node_id)
    if not node:
        raise ValueError(f"Query engine node {node_id} not found")
    if node.org_id != org_id:
        raise ValueError(f"Query engine node {node_id} not found")

    # Build response dict from the dataclass
    result = {
        "id": node.id,
        "org_id": node.org_id,
        "name": node.name,
        "host": node.host,
        "port": node.port,
        "database": node.database,
        "admin_user": node.admin_user,
        "status": node.status,
        "status_message": node.status_message,
        "created_at": node.created_at,
        "updated_at": node.updated_at,
        "project_count": node.project_count,
        "connection_strings": {
            "postgresql": f"postgresql://{node.host}:{node.port}/{node.database}",
            "odbc": f"Driver={{PostgreSQL Unicode}};Server={node.host};Port={node.port};Database={node.database}",
            "jdbc": f"jdbc:postgresql://{node.host}:{node.port}/{node.database}",
        },
    }
    return result
