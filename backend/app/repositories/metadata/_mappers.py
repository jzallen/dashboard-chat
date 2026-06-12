"""Record-to-dict mappers for metadata aggregates.

Pure functions that convert SQLAlchemy ORM records into plain dict payloads
consumed at the repository's public boundary. Kept module-level (not static
methods) to isolate presentation from persistence concerns and shrink the
MetadataRepository class.
"""

from typing import Any

from .dataset_record import DatasetRecord
from .organization_record import OrganizationRecord
from .project_memory_record import ProjectMemoryRecord
from .project_record import ProjectRecord
from .report_record import ReportRecord
from .session_record import SessionRecord
from .source_record import SourceRecord
from .transform_record import TransformRecord
from .view_record import ViewRecord


def _iso(dt: Any) -> str | None:
    """Return ISO-8601 string for a datetime, or None if the value is None."""
    return dt.isoformat() if dt else None


def project_to_dict(project: ProjectRecord) -> dict[str, Any]:
    """Convert ProjectRecord to dictionary."""
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "org_id": project.org_id,
        "created_by": project.created_by,
        "created_at": _iso(project.created_at),
        "updated_at": _iso(project.updated_at),
    }


def memory_to_dict(memory: ProjectMemoryRecord) -> dict[str, Any]:
    """Convert ProjectMemoryRecord to dictionary."""
    return {
        "id": memory.id,
        "project_id": memory.project_id,
        "org_id": memory.org_id,
        "stream_channel_id": memory.stream_channel_id,
        "created_at": _iso(memory.created_at),
    }


def session_to_dict(session: SessionRecord) -> dict[str, Any]:
    """Convert SessionRecord to dictionary."""
    return {
        "id": session.id,
        "memory_id": session.memory_id,
        "stream_thread_id": session.stream_thread_id,
        "owner_id": session.owner_id,
        "title": session.title,
        "org_id": session.org_id,
        "created_at": _iso(session.created_at),
        "last_active_at": _iso(session.last_active_at),
        # J-002 MR-2: surface the column that MR-2a (b496fe6) added on the
        # write side. The read side needs the value for `resumeSession` to
        # populate `active_scope.resource_*` per US-205 / DWD-2.
        "active_dataset_id": session.active_dataset_id,
    }


def dataset_summary(dataset: DatasetRecord) -> dict[str, Any]:
    """Compact dataset projection used when listing projects."""
    return {
        "id": dataset.id,
        "name": dataset.name,
        "link": f"/api/datasets/{dataset.id}",
        "description": dataset.description,
        "schema_config": dataset.schema_config,
    }


def dataset_to_dict(dataset: DatasetRecord) -> dict[str, Any]:
    """Convert DatasetRecord to dictionary."""
    return {
        "id": dataset.id,
        "storage_path": dataset.storage_path,
        "project_id": dataset.project_id,
        "name": dataset.name,
        "description": dataset.description,
        "schema_config": dataset.schema_config,
        "partition_fields": dataset.partition_fields,
        "column_profiles": dataset.column_profiles,
        "format_context": dataset.format_context,
        "row_count": dataset.row_count,
        "created_at": _iso(dataset.created_at),
        "updated_at": _iso(dataset.updated_at),
    }


def source_to_dict(source: SourceRecord) -> dict[str, Any]:
    """Convert SourceRecord to dictionary (wire-facing, ISO-8601 timestamps)."""
    return {
        "id": source.id,
        "project_id": source.project_id,
        "name": source.name,
        "schema_config": source.schema_config,
        "created_by": source.created_by,
        "created_at": _iso(source.created_at),
        "updated_at": _iso(source.updated_at),
    }


def transform_to_dict(transform: TransformRecord) -> dict[str, Any]:
    """Convert TransformRecord to dictionary."""
    return {
        "id": transform.id,
        "dataset_id": transform.dataset_id,
        "name": transform.name,
        "description": transform.description,
        "condition_json": transform.condition_json,
        "condition_sql": transform.condition_sql,
        "version": transform.version,
        "status": transform.status,
        "nl_prompt": transform.nl_prompt,
        "created_at": _iso(transform.created_at),
        "updated_at": _iso(transform.updated_at),
        "transform_type": transform.transform_type,
        "target_column": transform.target_column,
        "expression_sql": transform.expression_sql,
        "expression_config": transform.expression_config,
    }


def organization_to_dict(org: OrganizationRecord) -> dict[str, Any]:
    """Convert OrganizationRecord to dictionary.

    Carries the org-settings columns (``slug``/``region``/``default_*``)
    alongside identity so the org-settings assembly (see
    ``get_org_settings`` use case) can read the persisted configuration. The
    ``id``/``name``/``created_at`` keys remain for existing callers.
    """
    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "region": org.region,
        "default_engine": org.default_engine,
        "default_materialization": org.default_materialization,
        "default_model_prefix": org.default_model_prefix,
        "created_at": _iso(org.created_at),
        "updated_at": _iso(org.updated_at),
    }


def view_to_dict(view: ViewRecord) -> dict[str, Any]:
    """Convert ViewRecord to dictionary.

    Unlike the wire-facing mappers (project/dataset/etc.), this dict is
    re-hydrated into a ``View`` domain model by the create/get view use cases;
    the model's ``serialize()`` is the actual response boundary that performs
    the ISO-8601 conversion. Returning raw ``datetime`` values here (rather
    than pre-stringifying via ``_iso``) keeps the conversion at the boundary
    and avoids a ``str`` landing in ``View.created_at: datetime | None``,
    which previously crashed ``serialize()`` with HTTP 500.
    """
    return {
        "id": view.id,
        "project_id": view.project_id,
        "org_id": view.org_id,
        "name": view.name,
        "description": view.description,
        "sql_definition": view.sql_definition,
        "source_refs": view.source_refs,
        "columns": view.columns or [],
        "joins": view.joins or [],
        "filters": view.filters or [],
        "grain": view.grain,
        "materialization": view.materialization,
        "created_at": view.created_at,
        "updated_at": view.updated_at,
    }


def report_to_dict(report: ReportRecord) -> dict[str, Any]:
    """Convert ReportRecord to dictionary.

    Like ``view_to_dict``, this dict is re-hydrated into a ``Report`` domain
    model by the create/get report use cases; the model's ``serialize()`` is
    the response boundary that performs the ISO-8601 conversion. Returning raw
    ``datetime`` values here keeps the conversion at the boundary and avoids a
    ``str`` landing in ``Report.created_at``, which previously crashed
    ``serialize()`` with HTTP 500.
    """
    return {
        "id": report.id,
        "project_id": report.project_id,
        "org_id": report.org_id,
        "name": report.name,
        "description": report.description,
        "sql_definition": report.sql_definition,
        "report_type": report.report_type,
        "source_refs": report.source_refs,
        "domain": report.domain,
        "columns_metadata": report.columns_metadata,
        "materialization": report.materialization,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }
