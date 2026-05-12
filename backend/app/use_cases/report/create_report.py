"""Create report use case.

ADR-026 MR-3 / Phase 03-03: the storage ``sql_definition`` column is now
ALWAYS derived by :class:`ReportIbisCompiler` from structured
``columns_metadata`` (dimensions + measures). There is no caller-supplied
SQL path remaining — the ``sql_definition`` parameter on this use-case
function exists exclusively to surface a NAMED structured rejection
(:class:`DeprecatedSqlDefinitionField`) when a legacy caller still supplies
it (DWD-5: rejection at the use-case boundary, not at the schema layer).
"""

from typing import TYPE_CHECKING

from returns.result import Result

from app.models.report import Report
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.report.column_validation import validate_columns_metadata
from app.use_cases.report.exceptions import (
    DeprecatedSqlDefinitionField,
    InvalidReportReference,
    ReportRequiresDimension,
)
from app.use_cases.report.report_ibis_compiler import ReportIbisCompiler
from app.use_cases.view.dependency_service import DependencyService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer

# Map dataset schema_config field types (the wire format the dataset records
# carry) to the ibis dtypes the compiler consumes. Mirrors the analogous
# table in :mod:`app.models.dataset_sql` so the report-side schema-derivation
# path stays consistent with the dataset-side compilation.
_SCHEMA_TYPE_TO_IBIS = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
    "date": "date",
    "datetime": "timestamp",
}

_AGGREGATING_ROLES = {"dimension", "measure"}


@handle_returns
@with_repositories
async def create_report(
    project_id: str,
    name: str,
    report_type: str,
    source_refs: list[dict] | None = None,
    description: str | None = None,
    domain: str = "Organization",
    columns_metadata: list[dict] | None = None,
    materialization: str = "view",
    project: dict | None = None,
    sql_definition: str | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[Report, str]:
    """Create a new report in a project.

    Args:
        project_id: The parent project UUID.
        name: Report display name.
        report_type: Either "fact" or "dimension".
        source_refs: List of source references (dataset or view IDs).
        description: Optional description.
        domain: Business domain (default: Organization).
        columns_metadata: Semantic column metadata. ``semantic_role`` of
            ``dimension`` / ``measure`` drives :class:`ReportIbisCompiler`
            to derive the stored SQL end-to-end.
        materialization: dbt materialization strategy.
        sql_definition: DEPRECATED. Reserved exclusively for the structured
            rejection path — any truthy value triggers
            :class:`DeprecatedSqlDefinitionField`. Per ADR-026 §"Decision
            outcome" item 2 the storage SQL is now ALWAYS derived from
            ``columns_metadata``.

    Raises:
        DeprecatedSqlDefinitionField: If ``sql_definition`` is supplied (any
            truthy value). Raised BEFORE project/source-ref work so the
            compiler is never invoked and no repository write occurs.
        ProjectNotFound: If project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If any source refs point to non-existent entities.
        InvalidReportReference: If source refs contain report-type references.
        InvalidColumnMetadata: If columns_metadata contains invalid role/type pairs.
        ReportRequiresDimension: If columns_metadata contains measures but no
            dimensions (modeling violation per DWD-5). Raised AFTER semantic-
            role validation but BEFORE compiler invocation.
    """
    # Deprecation rejection runs FIRST — before any DB / dependency work —
    # so the rejection path has zero side effects (no report row, no
    # compiler invocation). This is the use-case boundary that DWD-5 names.
    if sql_definition:
        raise DeprecatedSqlDefinitionField()

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

    # ADR-026 §"Decision outcome" item 2 + DWD-5: a structurally-valid
    # columns_metadata carrying measures but zero dimensions is a report-
    # MODELING violation (a dimensionless aggregation has no GROUP BY
    # grain). Reject at the use-case boundary with a NAMED structured
    # error BEFORE compiler invocation; the compiler must never see a
    # dimensionless aggregation. Entity-only columns_metadata (no dims,
    # no measures) remains structurally valid — only measures-without-
    # dimensions is the violation.
    has_measure = any(c.get("semantic_role") == "measure" for c in cols)
    has_dimension = any(c.get("semantic_role") == "dimension" for c in cols)
    if has_measure and not has_dimension:
        raise ReportRequiresDimension()

    # Per ADR-026 MR-3: the storage ``sql_definition`` is ALWAYS derived by
    # :class:`ReportIbisCompiler` from structured columns_metadata. When
    # cols carry any role=dimension or role=measure entry the compiler
    # composes an aggregation; otherwise the storage column gets an empty
    # string (the no-aggregation case — pure entity-only or fully empty
    # columns_metadata).
    if any(c.get("semantic_role") in _AGGREGATING_ROLES for c in cols):
        schema = await _derive_source_schema(repositories, refs)
        compiler = ReportIbisCompiler()
        compiled_sql = compiler.generate_executable(
            source_refs=refs,
            columns_metadata=cols,
            schema=schema,
        )
    else:
        compiled_sql = ""

    report_dict = await repositories.metadata.create_report(
        project_id=project_id,
        org_id=project["org_id"],
        name=name,
        sql_definition=compiled_sql,
        report_type=report_type,
        source_refs=refs,
        description=description,
        domain=domain,
        columns_metadata=cols,
        materialization=materialization,
    )
    return Report(**{k: v for k, v in report_dict.items() if k in Report.__dataclass_fields__})


async def _derive_source_schema(repositories: "RepositoryContainer", refs: list[dict]) -> dict[str, dict[str, str]]:
    """Resolve per-source column dtypes from each ref's schema_config.

    Dataset refs resolve through ``metadata.get_dataset``; view refs through
    ``metadata.get_view`` (the view's ``columns`` enumerate display types
    that map back into ibis dtypes via the compiler's own type map). Refs
    whose source is missing collapse to an empty schema — the compiler
    falls back to ``string`` for any column the schema omits.
    """
    schema: dict[str, dict[str, str]] = {}
    for ref in refs:
        ref_id = ref["id"]
        if ref.get("type") == "dataset":
            ds = await repositories.metadata.get_dataset(ref_id, include_transforms=False)
            schema[ref_id] = _dataset_schema_to_ibis(ds.get("schema_config") if ds else None)
        elif ref.get("type") == "view":
            view = await repositories.metadata.get_view(ref_id)
            schema[ref_id] = _view_columns_to_ibis(view)
    return schema


def _dataset_schema_to_ibis(schema_config: dict | None) -> dict[str, str]:
    """Convert a dataset record's schema_config → {column: ibis_type}."""
    if not schema_config:
        return {}
    fields = schema_config.get("fields") or {}
    return {column: _SCHEMA_TYPE_TO_IBIS.get(info.get("type", "text"), "string") for column, info in fields.items()}


def _view_columns_to_ibis(view: dict | None) -> dict[str, str]:
    """Convert a view record's ``columns`` projection → {column: ibis_type}.

    The view-tier compiler's ``DisplayType`` is the source of truth for the
    column dtype; we map it back to ibis types the report compiler consumes.
    """
    if not view:
        return {}
    columns = view.get("columns") or []
    out: dict[str, str] = {}
    for col in columns:
        # The view stores the column under ``alias`` (the output name) when
        # set, else ``source_column``. The report-tier compiler references
        # the OUTPUT column name (what the view exposes), so we key the
        # schema on that.
        name = col.get("alias") or col.get("source_column") or col.get("name")
        display = col.get("display_type", "text")
        out[name] = _SCHEMA_TYPE_TO_IBIS.get(display, "string")
    return out
