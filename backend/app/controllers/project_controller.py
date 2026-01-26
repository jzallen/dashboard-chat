"""Controller for project operations."""

from typing import Any
from returns.result import Result, Success, Failure

from ..models import Project
from ..schemas import ProjectCreate, ProjectUpdate
from ..use_cases import project as project_use_cases


class ProjectController:
    """Controller for project operations."""

    @staticmethod
    async def list_projects() -> Result[list[Project], str]:
        """List all projects."""
        try:
            projects = await project_use_cases.list_projects()
            return Success(projects)
        except Exception as e:
            return Failure(f"Failed to list projects: {str(e)}")

    @staticmethod
    async def get_project(project_id: str) -> Result[dict[str, Any], str]:
        """Get a single project by ID with sparse dataset references."""
        try:
            result = await project_use_cases.get_project(project_id)
            if result is None:
                return Failure("Project not found")
            return Success(result)
        except Exception as e:
            return Failure(f"Failed to get project: {str(e)}")

    @staticmethod
    async def create_project(project_data: ProjectCreate) -> Result[Project, str]:
        """Create a new project."""
        try:
            project = await project_use_cases.create_project(
                name=project_data.name,
                description=project_data.description,
            )
            return Success(project)
        except Exception as e:
            return Failure(f"Failed to create project: {str(e)}")

    @staticmethod
    async def update_project(
        project_id: str,
        update_data: ProjectUpdate,
    ) -> Result[Project, str]:
        """Update a project."""
        try:
            update_dict = update_data.model_dump(exclude_unset=True)
            result = await project_use_cases.update_project(project_id, update_dict)
            if result is None:
                return Failure("Project not found")
            return Success(result)
        except Exception as e:
            return Failure(f"Failed to update project: {str(e)}")

    @staticmethod
    async def delete_project(project_id: str) -> Result[dict[str, str], str]:
        """Delete a project."""
        try:
            deleted = await project_use_cases.delete_project(project_id)
            if not deleted:
                return Failure("Project not found")
            return Success({"status": "deleted", "id": project_id})
        except Exception as e:
            return Failure(f"Failed to delete project: {str(e)}")
