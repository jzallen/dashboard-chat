"""Create report use case."""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.report import Report
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.report.column_validation import validate_columns_metadata
from app.use_cases.report.exceptions import InvalidReportReference
from app.use_cases.view.dependency_service import DependencyService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@with_repositories
@handle_returns
async def create_report(
    project_id: str,
    name: str,
    sql_definition: str,
    report_type: str,
    source_refs: list[dict] | None = None,
    description: str | None = None,
    domain: str = "Organization",
    columns_metadata: list[dict] | None = None,
    materialization: str = "view",
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Report, str]:
    """Create a new report in a project.

    Args:
        project_id: The parent project UUID.
        name: Report display name.
        sql_definition: SQL query defining the transformation.
        report_type: Either "fact" or "dimension".
        source_refs: List of source references (dataset or view IDs).
        description: Optional description.
        domain: Business domain (default: Organization).
        columns_metadata: Semantic column metadata.
        materialization: dbt materialization strategy.

    Raises:
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If any source refs point to non-existent entities.
        InvalidReportReference: If source refs contain report-type references.
        InvalidColumnMetadata: If columns_metadata contains invalid role/type pairs.
    """
    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(project_id)

    refs = source_refs or []

    # Reports cannot reference other reports (no mart-to-mart deps)
    if any(ref.get("type") == "report" for ref in refs):
        raise InvalidReportReference()

    if refs:
        dep_svc = DependencyService(repositories.metadata)
        await dep_svc.validate_source_refs(refs, project_id)

    cols = columns_metadata or []
    if cols:
        validate_columns_metadata(cols)

    report_dict = await repositories.metadata.create_report(
        project_id=project_id,
        org_id=project["org_id"],
        name=name,
        sql_definition=sql_definition,
        report_type=report_type,
        source_refs=refs,
        description=description,
        domain=domain,
        columns_metadata=cols,
        materialization=materialization,
    )
    return Report(**{k: v for k, v in report_dict.items() if k in Report.__dataclass_fields__})
