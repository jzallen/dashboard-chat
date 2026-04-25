"""Get SQL access details for a project."""

from types import SimpleNamespace
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt.naming import to_snake_case
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._engine import resolve_engine_node_by_id
from app.use_cases.sql_access._response import build_connection_response

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def get_sql_access(
    project_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Get SQL access connection details for a project.

    Returns connection details (without password) if enabled,
    including per-dataset sync status derived from the outbox.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    metadata_repo = repositories.metadata

    ctx = await load_context(project_id, project, repositories)
    access_record = ctx.access_record
    if not access_record or not access_record.enabled:
        return {"project_id": project_id, "enabled": False}

    # Resolve engine node; silently fall back to settings-derived defaults when
    # access_record.engine_node_id is unset OR the lookup returns None.
    engine_node = None
    if access_record.engine_node_id:
        engine_node = await resolve_engine_node_by_id(
            access_record.engine_node_id, repositories, fallback_to_settings=True
        )
    if engine_node is None:
        settings = get_settings()
        engine_node = SimpleNamespace(
            host=settings.query_engine_host,
            port=settings.query_engine_port,
            database=settings.query_engine_database,
        )

    # Get per-dataset sync status
    records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=False)
    dataset_ids = [r.id if hasattr(r, "id") else r["id"] for r in records]
    sync_statuses = await repositories.outbox.get_sync_status_by_dataset(dataset_ids)

    datasets_sync = []
    for r in records:
        ds = Dataset.from_record(r, include_transforms=False)
        ds_id = ds.id
        datasets_sync.append(
            {
                "dataset_id": ds_id,
                "name": ds.name,
                "view_name": to_snake_case(ds.name),
                "sync_status": sync_statuses.get(ds_id, "synced"),
            }
        )

    return build_connection_response(
        engine_node,
        schema=access_record.pg_schema,
        username=access_record.pg_proxy_role or access_record.pg_role,
        password=None,
        extras={
            "project_id": project_id,
            "enabled": True,
            # engine_node_id reflects the access record's stored id, NOT the
            # resolved node's id — preserves the silent-fallback semantics where
            # the response still reports the original (possibly-stale) reference.
            "engine_node_id": access_record.engine_node_id,
            "last_synced_at": access_record.last_synced_at,
            "created_at": access_record.created_at,
            "datasets": datasets_sync,
        },
    )
