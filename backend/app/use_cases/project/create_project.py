"""Create project use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def create_project(
    name: str,
    user: AuthUser,
    description: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Create a new project and emit a ProjectCreated outbox event.

    Memory provisioning is handled when the first session is created,
    triggered by the outbox event consumer.

    Args:
        name: The project name.
        user: The authenticated user (injected by router).
        description: Optional description.

    Returns:
        Success with created project dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata
    outbox_repo = repositories.outbox

    project = await metadata_repo.create_project(
        name=name, description=description, org_id=user.org_id, created_by=user.id
    )

    # Emit ProjectCreated outbox event — memory provisioning happens
    # when the outbox dispatcher processes this event.
    await outbox_repo.submit_project_created_event(
        project_id=project["id"],
        org_id=user.org_id,
        created_by=user.id,
    )

    return project
