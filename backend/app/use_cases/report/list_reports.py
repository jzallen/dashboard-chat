"""List reports use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.report import Report
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def list_reports(
    project_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[list[Report], str]:
    """List all reports for a project.

    Args:
        project_id: The parent project UUID.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(project_id)

    report_records = await repositories.metadata.list_reports_by_project(project_id)
    return [Report.from_record(r) for r in report_records]
