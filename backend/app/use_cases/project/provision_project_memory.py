"""Provision a project memory (Stream channel) from a ProjectCreated outbox event."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.utils.compact_id import memory_channel_id

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def provision_project_memory(
    project_id: str,
    org_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[dict, str]:
    """Create a project memory mapping.

    Generates a deterministic Stream channel ID and records the mapping.
    The actual Stream channel creation is handled externally (by the caller
    or a Stream service). This use case only manages the database record.

    Args:
        project_id: The project to provision memory for.
        org_id: The organization ID.

    Returns:
        Success with memory dict, or Failure with error message.
    """
    metadata_repo = repositories.metadata

    # Check if memory already exists (idempotent)
    existing = await metadata_repo.get_project_memory(project_id)
    if existing:
        return existing

    channel_id = memory_channel_id(org_id, project_id)
    return await metadata_repo.create_project_memory(
        project_id=project_id,
        org_id=org_id,
        stream_channel_id=channel_id,
    )
