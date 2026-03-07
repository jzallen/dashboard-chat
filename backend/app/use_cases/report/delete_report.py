"""Delete report use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.report.exceptions import ReportNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def delete_report(
    report_id: str,
    *,
    repositories: "RepositoryContainer",
) -> Result[bool, str]:
    """Delete a report.

    Args:
        report_id: The UUID of the report to delete.

    Raises:
        ReportNotFound: If report with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    report_dict = await repositories.metadata.get_report(report_id)
    if report_dict is None:
        raise ReportNotFound(report_id)

    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(report_dict["project_id"])

    deleted = await repositories.metadata.delete_report(report_id)
    if not deleted:
        raise ReportNotFound(report_id)

    return True
