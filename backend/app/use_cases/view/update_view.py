"""Update view use case."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.models.view import DisplayType, View, ViewColumn, ViewFilter, ViewGrain, ViewJoin
from app.repositories import with_repositories
from app.use_cases import handle_returns
from app.use_cases.project.project_service import ProjectService
from app.use_cases.view.dependency_service import DependencyService
from app.use_cases.view.exceptions import ViewNotFound
from app.use_cases.view.grain_service import assign_grain_roles
from app.use_cases.view.sql_generator import ViewSQLGenerator

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def update_view(
    view_id: str,
    update_data: dict[str, Any],
    project: dict | None = None,
    *,
    repositories: "RepositoryContainer",
) -> Result[View, str]:
    """Update a view.

    Args:
        view_id: The UUID of the view to update.
        update_data: Fields to update.

    Raises:
        ViewNotFound: If view with given ID does not exist.
        ProjectNotFound: If parent project does not exist.
        AuthorizationError: If user's org does not own the project.
        InvalidSourceReference: If updated source refs point to non-existent entities.
        CircularDependency: If updated source refs would create a cycle.
    """
    view_dict = await repositories.metadata.get_view(view_id)
    if view_dict is None:
        raise ViewNotFound(view_id)

    if project is None:
        svc = ProjectService(repositories)
        project = await svc.fetch_project(view_dict["project_id"])

    # Re-validate source_refs if they are being changed
    if "source_refs" in update_data and update_data["source_refs"] is not None:
        dep_svc = DependencyService(repositories.metadata)
        await dep_svc.validate_source_refs(update_data["source_refs"], view_dict["project_id"])
        await dep_svc.check_circular_dependencies(view_id, update_data["source_refs"])

    # Check if structural fields are being updated
    structural_fields = {"columns", "joins", "filters", "grain"}
    has_structural_update = any(f in update_data for f in structural_fields)

    if has_structural_update:
        # Merge with existing values for fields not in update_data
        columns_raw = update_data.get("columns", view_dict.get("columns", []))
        joins_raw = update_data.get("joins", view_dict.get("joins", []))
        filters_raw = update_data.get("filters", view_dict.get("filters", []))
        grain_raw = update_data.get("grain", view_dict.get("grain"))

        # Parse structured definitions
        parsed_columns = _parse_columns(columns_raw)
        parsed_joins = _parse_joins(joins_raw)
        parsed_filters = _parse_filters(filters_raw)
        parsed_grain = _parse_grain(grain_raw)

        # Auto-assign grain roles
        parsed_columns = assign_grain_roles(parsed_columns, parsed_grain)

        # Serialize back to dicts for storage
        update_data["columns"] = [_column_to_dict(c) for c in parsed_columns]
        update_data["joins"] = [_join_to_dict(j) for j in parsed_joins]
        update_data["filters"] = [_filter_to_dict(f) for f in parsed_filters]
        update_data["grain"] = _grain_to_dict(parsed_grain)

        # Regenerate SQL from structure
        source_refs = update_data.get("source_refs", view_dict.get("source_refs", []))
        temp_view = View(
            id=view_id,
            project_id=view_dict["project_id"],
            org_id=view_dict["org_id"],
            name=update_data.get("name", view_dict["name"]),
            sql_definition="",
            source_refs=source_refs,
            columns=parsed_columns,
            joins=parsed_joins,
            filters=parsed_filters,
            grain=parsed_grain,
        )
        generator = ViewSQLGenerator()
        if parsed_columns:
            update_data["sql_definition"] = generator.generate_executable(temp_view)

    updated = await repositories.metadata.update_view(view_id, **update_data)
    if updated is None:
        raise ViewNotFound(view_id)

    return View.from_record(updated)


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


def _parse_filters(raw: list[dict]) -> list[ViewFilter]:
    return [
        ViewFilter(
            source_ref=f["source_ref"],
            column=f["column"],
            operator=f["operator"],
            value=f.get("value"),
        )
        for f in raw
    ]


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


def _filter_to_dict(f: ViewFilter) -> dict:
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
