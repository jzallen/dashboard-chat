"""Update report use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.report import Report
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.report.column_validation import validate_columns_metadata
from app.use_cases.report.exceptions import InvalidReportReference, ReportNotFound
from app.use_cases.view.dependency_service import DependencyService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def update_report(
    report_id: str,
    update_data: dict[str, Any],
    *,
    repositories: "RepositoryContainer",
) -> Result[Report, str]:
    """Update a report.

    Args:
        report_id: The UUID of the report to update.
        update_data: Fields to update.

    Raises:
        ReportNotFound: If report with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If updated source refs point to non-existent entities.
        InvalidReportReference: If source refs contain report-type references.
        InvalidColumnMetadata: If columns_metadata contains invalid role/type pairs.
    """
    report_dict = await repositories.metadata.get_report(report_id)
    if report_dict is None:
        raise ReportNotFound(report_id)

    svc = ProjectService(repositories)
    await svc.fetch_and_authorize_project(report_dict["project_id"])

    # Re-validate source_refs if they are being changed
    if "source_refs" in update_data and update_data["source_refs"] is not None:
        # Reports cannot reference other reports (no mart-to-mart deps)
        if any(ref.get("type") == "report" for ref in update_data["source_refs"]):
            raise InvalidReportReference()

        dep_svc = DependencyService(repositories.metadata)
        await dep_svc.validate_source_refs(update_data["source_refs"], report_dict["project_id"])

    # Validate columns_metadata if provided
    cols = update_data.get("columns_metadata")
    if cols is not None and cols:
        validate_columns_metadata(cols)

    updated = await repositories.metadata.update_report(report_id, **update_data)
    if updated is None:
        raise ReportNotFound(report_id)

    return Report.from_record(updated)
