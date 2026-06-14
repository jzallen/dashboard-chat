"""Pure dbt file-plan builder — the single source of truth for the zip + manifest.

`build_dbt_file_plan` computes the list of ``(path, layer, ref)`` entries the dbt
export contains, WITHOUT generating any bytes. ``generate_dbt_project_zip``
(``_dbt/__init__.py``) consumes this plan to decide what to write, so the JSON
manifest endpoint and the zip download can never drift: a file added to the zip
is, by construction, a file in the plan.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, TypedDict

from .naming import deduplicate_names, resolved_view_names
from .naming import to_snake_case as to_snake_case
from .schema_yml import schema_uses_dbt_utils

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.report import Report
    from app.models.view import View

__all__ = ["DbtFileEntry", "build_dbt_file_plan", "report_model_prefix"]


class DbtFileEntry(TypedDict, total=False):
    """One file in the dbt export tree.

    ``path`` and ``layer`` are always present. ``ref`` is the dbt model name for
    model entries (``staging``/``intermediate``/``mart``); ``config`` files omit
    it. ``layer`` matches the UI ``Layer | "config"`` union
    (``source|staging|intermediate|mart|config``).
    """

    path: str
    layer: str
    ref: str


def report_model_prefix(report_type: str) -> str:
    """Return the dbt model prefix for a report type (``fct`` for facts, else ``dim``)."""
    return "fct" if report_type == "fact" else "dim"


def _config_entry(path: str) -> DbtFileEntry:
    return {"path": path, "layer": "config"}


def build_dbt_file_plan(
    project: Project,
    *,
    views: list[View] | None = None,
    reports: list[Report] | None = None,
) -> list[DbtFileEntry]:
    """The list of files the dbt zip will contain — paths + layers + refs, no bytes.

    The ordering and naming mirror ``generate_dbt_project_zip`` exactly so the two
    share one path/layer source of truth.
    """
    datasets = project.datasets or []
    views = views or []
    reports = reports or []

    # Resolve in lockstep with generate_dbt_project_zip: a user-set ``model_name``
    # names the staging source/model, else the deduplicated snake fallback.
    dataset_view_names = resolved_view_names(datasets)
    dataset_pairs = list(zip(dataset_view_names, datasets, strict=False))

    view_snake_names = deduplicate_names([v.name for v in views])
    view_pairs = list(zip(view_snake_names, views, strict=False))

    report_snake_names = deduplicate_names([r.name for r in reports])
    report_pairs = list(zip(report_snake_names, reports, strict=False))

    entries: list[DbtFileEntry] = [
        _config_entry("dbt_project.yml"),
        _config_entry("profiles.yml"),
        _config_entry("models/staging/sources.yml"),
        _config_entry("models/schema.yml"),
    ]
    if schema_uses_dbt_utils(dataset_pairs):
        entries.append(_config_entry("packages.yml"))
    entries.append(_config_entry("macros/custom_functions.sql"))
    entries.append(_config_entry("scripts/bootstrap_db.sql"))
    entries.append(_config_entry("README.md"))

    for view_name, _ds in dataset_pairs:
        staging_model = view_name if view_name.startswith("stg_") else f"stg_{view_name}"
        entries.append(
            {
                "path": f"models/staging/{staging_model}.sql",
                "layer": "staging",
                "ref": staging_model,
            }
        )

    for snake_name, _view in view_pairs:
        entries.append(
            {
                "path": f"models/intermediate/int_{snake_name}.sql",
                "layer": "intermediate",
                "ref": f"int_{snake_name}",
            }
        )

    for snake_name, report in report_pairs:
        prefix = report_model_prefix(report.report_type)
        domain_snake = to_snake_case(report.domain)
        entries.append(
            {
                "path": f"models/marts/{domain_snake}/{prefix}_{snake_name}.sql",
                "layer": "mart",
                "ref": f"{prefix}_{snake_name}",
            }
        )

    return entries
