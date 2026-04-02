"""Get report use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.report import Report
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.report.exceptions import ReportNotFound

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def get_report(
    report_id: str,
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Report, str]:
    """Get a single report by ID.

    Args:
        report_id: The UUID of the report to retrieve.

    Raises:
        ReportNotFound: If report with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
    """
    report_dict = await repositories.metadata.get_report(report_id)
    if report_dict is None:
        raise ReportNotFound(report_id)

    # Authorize via the parent project
    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(report_dict["project_id"])

    return Report(**{k: v for k, v in report_dict.items() if k in Report.__dataclass_fields__})
