"""Create source use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def create_source(
    project_id: str,
    name: str,
    user: AuthUser,
    schema_config: dict[str, Any] | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Create a new Source within a project and emit a SourceCreated event.

    The Source is the logical table that one or more uploaded files (sharing a
    schema) back; its public SELECT * view is a Dataset linked via
    ``datasets.source_id`` (wired in a later slice). This use case is fast — it
    performs no file work.

    Args:
        project_id: The parent project UUID.
        name: The source display name.
        user: The authenticated user (injected by router).
        schema_config: The locked schema used to match appended files.

    Returns:
        Success with the created Source dict, or Failure on error.

    Raises:
        ProjectNotFound: If the project does not exist.
    """
    metadata_repo = repositories.metadata
    outbox_repo = repositories.outbox

    if not await metadata_repo.project_exists(project_id):
        raise ProjectNotFound(project_id)

    source = await metadata_repo.create_source(
        project_id=project_id,
        name=name,
        schema_config=schema_config,
        created_by=user.id,
    )

    await outbox_repo.submit_source_created_event(
        source_id=source["id"],
        project_id=project_id,
        created_by=user.id,
    )

    return source
