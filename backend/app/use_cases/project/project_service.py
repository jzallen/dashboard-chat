"""Shared logic for project use cases.

Provides the ProjectService class for operations shared across
get_project, update_project, delete_project, export_dbt_project, etc.
"""

from typing import TYPE_CHECKING

from app.use_cases.project.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


class ProjectService:
    """Shared project operations used by multiple use cases."""

    def __init__(self, repositories: "RepositoryContainer"):
        self._metadata_repo = repositories.metadata

    async def fetch_project(
        self,
        project_id: str,
    ) -> dict:
        """Fetch a project by ID.

        Authorization is handled at the router layer via authorize_project_access.

        Raises:
            ProjectNotFound: If project with given ID does not exist.
        """
        project_dict = await self._metadata_repo.get_project(project_id)

        if project_dict is None:
            raise ProjectNotFound(project_id)

        return project_dict
