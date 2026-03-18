"""Create view use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.view import View
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.dependency_service import DependencyService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_view(
    project_id: str,
    name: str,
    sql_definition: str,
    source_refs: list[dict] | None = None,
    description: str | None = None,
    materialization: str = "ephemeral",
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[View, str]:
    """Create a new view in a project.

    Args:
        project_id: The parent project UUID.
        name: View display name.
        sql_definition: SQL query defining the transformation.
        source_refs: List of source references (dataset or view IDs).
        description: Optional description.
        materialization: dbt materialization strategy.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If any source refs point to non-existent entities.
    """
    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(project_id)

    refs = source_refs or []
    if refs:
        dep_svc = DependencyService(repositories.metadata)
        await dep_svc.validate_source_refs(refs, project_id)

    view_dict = await repositories.metadata.create_view(
        project_id=project_id,
        org_id=project["org_id"],
        name=name,
        sql_definition=sql_definition,
        source_refs=refs,
        description=description,
        materialization=materialization,
    )
    return View(**{k: v for k, v in view_dict.items() if k in View.__dataclass_fields__})
