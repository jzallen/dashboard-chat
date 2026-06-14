"""Get SQL access details for a project."""

from types import SimpleNamespace
from typing import TYPE_CHECKING

from returns.result import Result

from app.config import get_settings
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt.naming import resolved_view_name
from app.use_cases.sql_access._context import load_context
from app.use_cases.sql_access._engine import resolve_engine_node_by_id
from app.use_cases.sql_access._response import build_connection_response

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


def _settings_engine_node_stub() -> SimpleNamespace:
    """Build an engine-node-shaped object from settings for the silent fallback."""
    settings = get_settings()
    return SimpleNamespace(
        host=settings.query_engine_host,
        port=settings.query_engine_port,
        database=settings.query_engine_database,
    )


async def _resolve_engine_node_or_fallback(
    engine_node_id: str | None,
    repositories: "RepositoryContainer",
):
    """Resolve the engine node, silently falling back to settings.

    Falls back when ``engine_node_id`` is unset OR when the lookup returns
    None. Returns an object exposing ``.host``, ``.port``, and ``.database``
    so the caller can pass it uniformly to ``build_connection_response``.
    """
    if engine_node_id:
        engine_node = await resolve_engine_node_by_id(engine_node_id, repositories, fallback_to_settings=True)
        if engine_node is not None:
            return engine_node
    return _settings_engine_node_stub()


async def _load_dataset_sync_entries(project_id: str, repositories: "RepositoryContainer") -> list[dict]:
    """Build the per-dataset sync-status entries for the response."""
    metadata_repo = repositories.metadata
    records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=False)
    dataset_ids = [r.id if hasattr(r, "id") else r["id"] for r in records]
    sync_statuses = await repositories.outbox.get_sync_status_by_dataset(dataset_ids)

    entries: list[dict] = []
    for record in records:
        dataset = Dataset.from_record(record, include_transforms=False)
        entries.append(
            {
                "dataset_id": dataset.id,
                "name": dataset.name,
                "view_name": resolved_view_name(dataset),
                "sync_status": sync_statuses.get(dataset.id, "synced"),
            }
        )
    return entries


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
    ctx = await load_context(project_id, project, repositories)
    access_record = ctx.access_record
    if not access_record or not access_record.enabled:
        return {"project_id": project_id, "enabled": False}

    engine_node = await _resolve_engine_node_or_fallback(access_record.engine_node_id, repositories)
    datasets_sync = await _load_dataset_sync_entries(project_id, repositories)

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
