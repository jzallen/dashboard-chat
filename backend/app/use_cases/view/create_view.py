"""Create view use case."""

from typing import TYPE_CHECKING

from pydantic import ValidationError
from returns.result import Result

from app.models.view import (
    DisplayType,
    View,
    ViewColumn,
    ViewFilterVariant,
    ViewGrain,
    ViewJoin,
    parse_view_filter,
)
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.dependency_service import DependencyService
from app.use_cases.view.exceptions import InvalidViewFilter
from app.use_cases.view.grain_service import assign_grain_roles
from app.use_cases.view.sql_generator import ViewIbisCompiler

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def create_view(
    project_id: str,
    name: str,
    sql_definition: str = "",
    source_refs: list[dict] | None = None,
    columns: list[dict] | None = None,
    joins: list[dict] | None = None,
    filters: list[dict] | None = None,
    grain: dict | None = None,
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
        columns: Structured column definitions.
        joins: Join definitions.
        filters: Filter definitions.
        grain: Grain definition.
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

    # Parse structured definitions
    parsed_columns = _parse_columns(columns or [])
    parsed_joins = _parse_joins(joins or [])
    parsed_filters = _parse_filters(filters or [])
    parsed_grain = _parse_grain(grain)

    # Auto-assign grain roles
    parsed_columns = assign_grain_roles(parsed_columns, parsed_grain)

    # Serialize back to dicts for storage
    columns_dicts = [_column_to_dict(c) for c in parsed_columns]
    joins_dicts = [_join_to_dict(j) for j in parsed_joins]
    filters_dicts = [_filter_to_dict(f) for f in parsed_filters]
    grain_dict = _grain_to_dict(parsed_grain)

    # Build a temporary View to generate SQL
    temp_view = View(
        id="",
        project_id=project_id,
        org_id=project["org_id"],
        name=name,
        sql_definition="",
        source_refs=refs,
        columns=parsed_columns,
        joins=parsed_joins,
        filters=parsed_filters,
        grain=parsed_grain,
    )

    compiler = ViewIbisCompiler()
    generated_sql = compiler.generate_executable(temp_view) if parsed_columns else sql_definition

    view_dict = await repositories.metadata.create_view(
        project_id=project_id,
        org_id=project["org_id"],
        name=name,
        sql_definition=generated_sql,
        source_refs=refs,
        columns=columns_dicts,
        joins=joins_dicts,
        filters=filters_dicts,
        grain=grain_dict,
        description=description,
        materialization=materialization,
    )
    return View(**{k: v for k, v in view_dict.items() if k in View.__dataclass_fields__})


def _parse_columns(raw: list[dict]) -> list[ViewColumn]:
    return [
        ViewColumn(
            name=c["name"],
            source_ref=c["source_ref"],
            source_column=c["source_column"],
            display_type=DisplayType(c["display_type"]),
            grain_role=None,
            alias=c.get("alias"),
        )
        for c in raw
    ]


def _parse_joins(raw: list[dict]) -> list[ViewJoin]:
    return [
        ViewJoin(
            left_ref=j["left_ref"],
            left_column=j["left_column"],
            right_ref=j["right_ref"],
            right_column=j["right_column"],
            join_type=j.get("join_type", "INNER"),
        )
        for j in raw
    ]


def _parse_filters(raw: list[dict]) -> list[ViewFilterVariant]:
    """Parse raw filter dicts into discriminated-union ViewFilter variants.

    Per ADR-026 MR-1: malformed operators (anything outside the
    ``ALLOWED_FILTER_OPERATORS`` set) surface as ``InvalidViewFilter`` here,
    before the compiler is invoked. The per-operator value typing (scalar /
    list / None) is enforced in the same validation pass.
    """
    parsed: list[ViewFilterVariant] = []
    for raw_filter in raw:
        try:
            parsed.append(
                parse_view_filter(
                    {
                        "source_ref": raw_filter["source_ref"],
                        "column": raw_filter["column"],
                        "operator": raw_filter["operator"],
                        "value": raw_filter.get("value"),
                    }
                )
            )
        except ValidationError as err:
            rejected = _rejected_field(err)
            raise InvalidViewFilter(_format_validation_error(err), rejected_field=rejected) from err
    return parsed


def _rejected_field(err: ValidationError) -> str:
    """Pull the most-informative field name out of a Pydantic error."""
    for entry in err.errors():
        if entry.get("type") == "union_tag_invalid":
            return "operator"
        loc = entry.get("loc") or ()
        if loc:
            return str(loc[-1])
    return "operator"


def _format_validation_error(err: ValidationError) -> str:
    primary = err.errors()[0] if err.errors() else {"msg": str(err)}
    return primary.get("msg", str(err))


def _parse_grain(raw: dict | None) -> ViewGrain | None:
    if raw is None:
        return None
    return ViewGrain(
        time_column=raw["time_column"],
        dimensions=raw.get("dimensions", []),
    )


def _column_to_dict(c: ViewColumn) -> dict:
    return {
        "name": c.name,
        "source_ref": c.source_ref,
        "source_column": c.source_column,
        "display_type": c.display_type.value,
        "grain_role": c.grain_role.value if c.grain_role else None,
        "alias": c.alias,
    }


def _join_to_dict(j: ViewJoin) -> dict:
    return {
        "left_ref": j.left_ref,
        "left_column": j.left_column,
        "right_ref": j.right_ref,
        "right_column": j.right_column,
        "join_type": j.join_type,
    }


def _filter_to_dict(f: ViewFilterVariant) -> dict:
    return {
        "source_ref": f.source_ref,
        "column": f.column,
        "operator": f.operator,
        "value": f.value,
    }


def _grain_to_dict(g: ViewGrain | None) -> dict | None:
    if g is None:
        return None
    return {
        "time_column": g.time_column,
        "dimensions": g.dimensions,
    }
