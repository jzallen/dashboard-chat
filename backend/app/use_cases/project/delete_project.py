"""Delete project use case."""

import logging
from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.models.dataset import Dataset
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project._dbt.naming import resolved_view_name
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

logger = logging.getLogger(__name__)


@handle_returns
@with_repositories
async def delete_project(
    project_id: str,
    user: AuthUser | None = None,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[bool, str]:
    """Delete a project and all its datasets.

    Args:
        project_id: The UUID of the project to delete.
        user: The authenticated user (injected by router).

    Returns:
        Success with True if deleted, or Failure with error message.

    Raises:
        ProjectNotFound: If project with given ID does not exist.
    """
    metadata_repo = repositories.metadata

    # Emit DatasetRemoved events before deletion if SQL access is enabled
    engine_node_id = await repositories.external_access.get_active_engine_node_id(project_id)
    if engine_node_id:
        records, _, _ = await metadata_repo.list_datasets(project_id, include_transforms=False)
        for record in records:
            ds = Dataset.from_record(record, include_transforms=False)
            view_name = resolved_view_name(ds)
            await repositories.outbox.submit_dataset_removed_event(
                project_id=project_id,
                dataset_id=ds.id,
                engine_node_id=engine_node_id,
                view_name=view_name,
            )

    deleted = await metadata_repo.delete_project(project_id, org_id=user.org_id if user else None)

    if not deleted:
        raise ProjectNotFound(project_id)

    return True
