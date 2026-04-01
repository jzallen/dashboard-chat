"""Create session use case."""

import uuid
from typing import TYPE_CHECKING

from returns.result import Failure, Result, Success

from app.auth.types import AuthUser
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.exceptions import ProjectNotFound
from app.use_cases.project.provision_project_memory import provision_project_memory

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_session(
    project_id: str,
    user: AuthUser,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Create a new session (Stream thread) within a project's memory.

    If the project's memory hasn't been provisioned yet (pending
    ProjectCreated outbox event), provisions it before creating the session.

    Args:
        project_id: The project to create a session in.
        user: The authenticated user (becomes the session owner).

    Returns:
        Success with session dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata

    # Verify the project exists and belongs to the user's org
    project = await metadata_repo.get_project(project_id)
    if not project:
        raise ProjectNotFound(project_id)

    if project["org_id"] != user.org_id:
        raise ProjectNotFound(project_id)

    # Ensure memory is provisioned (delegates to provision_project_memory)
    memory = await metadata_repo.get_project_memory(project_id)
    if not memory:
        result = await provision_project_memory(project_id, org_id=user.org_id)
        match result:
            case Success(data):
                memory = data
            case Failure(_):
                raise ProjectNotFound(project_id)

    # Generate a thread ID. In production, this would be the ID of a root
    # message sent to the Stream channel. For now, generate a unique ID
    # that will be used as the thread anchor.
    stream_thread_id = str(uuid.uuid4())

    return await metadata_repo.create_session(
        memory_id=memory["id"],
        stream_thread_id=stream_thread_id,
        owner_id=user.id,
        org_id=user.org_id,
    )
