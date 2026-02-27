"""Shared logic for project use cases.

Provides the ProjectService class for operations shared across
get_project, update_project, delete_project, export_dbt_project, etc.
"""

from typing import TYPE_CHECKING

from app.auth import get_auth_user
from app.auth.exceptions import AuthorizationError
from app.models.dataset import Dataset
from app.use_cases.exceptions import ProjectNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


class ProjectService:
    """Shared project operations used by multiple use cases."""

    def __init__(self, repositories: "RepositoryContainer"):
        self._metadata_repo = repositories["metadata_repository"]

    async def fetch_and_authorize_project(
        self,
        project_id: str,
        include_datasets: bool = False,
    ) -> dict:
        """Fetch a project and verify the current user has access.

        Raises:
            ProjectNotFound: If project with given ID does not exist.
            AuthorizationError: If user's org does not own the project.
        """
        project_dict = await self._metadata_repo.get_project(
            project_id, include_datasets=include_datasets
        )

        if project_dict is None:
            raise ProjectNotFound(project_id)

        self._verify_org_access(project_dict, project_id)

        return project_dict

    async def fetch_full_datasets(self, project_dict: dict) -> list[Dataset]:
        """Fetch full dataset records (with transforms) for a project.

        Takes a project dict that includes sparse dataset references
        and returns fully-loaded Dataset domain objects.
        """
        sparse_datasets = project_dict.get("datasets", [])
        full_datasets = []
        for ds_info in sparse_datasets:
            record = await self._metadata_repo.get_dataset_record(
                ds_info["id"], include_transforms=True
            )
            if record:
                full_datasets.append(
                    Dataset.from_record(record, include_transforms=True)
                )
        return full_datasets

    @staticmethod
    def _verify_org_access(project_dict: dict, project_id: str) -> None:
        """Verify the current user's org owns the project.

        Uses the lenient check: allows access if org_id is None (legacy projects).
        """
        user = get_auth_user()
        if project_dict.get("org_id") and project_dict["org_id"] != user.org_id:
            raise AuthorizationError(f"Access denied to project {project_id}")
