"""Dataset domain model - authoritative business object.

This module defines the ``Dataset`` domain object. SQL compilation lives next
door in :mod:`app.models.dataset_sql`; execution against the query engine is
coordinated here via ``query_preview_rows``.
"""

import re
from dataclasses import dataclass, field
from typing import Any

from ..types import SQLQuery
from . import dataset_sql
from .transform import Transform

# Case-conversion modes that require the project's custom DuckDB macros
# (title/snake/kebab are not built-in to DuckDB's SQL dialect).
_CUSTOM_CASE_MODES = frozenset({"title", "snake", "kebab"})


def _iso_or_none(value: Any) -> str | None:
    """ISO-8601 string for a datetime, the value unchanged if already a string, else None.

    MR-7: cold-storage timestamps (``archived_at``/``retention_until``) ride the wire as ISO
    strings; the days-left countdown is derived frontend-side from ``retention_until``.
    """
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else value


def _transform_from_dict(payload: dict[str, Any]) -> Transform:
    """Build a ``Transform`` from a plain JSON-shaped dict payload."""
    from ..types import QueryBuilderJSON

    raw_condition = payload.get("condition_json")
    return Transform(
        id=payload.get("id"),
        name=payload["name"],
        condition_json=(QueryBuilderJSON.from_dict(raw_condition) if raw_condition else None),
        condition_sql=payload.get("condition_sql"),
        description=payload.get("description"),
        status=payload.get("status", "enabled"),
        transform_type=payload.get("transform_type", "filter"),
        target_column=payload.get("target_column"),
        expression_sql=payload.get("expression_sql"),
        expression_config=payload.get("expression_config"),
        created_at=payload.get("created_at"),
    )


def _transform_from_orm(record: Any) -> Transform:
    """Build a ``Transform`` from a SQLAlchemy-style ORM record.

    Older ORM records may not carry the newer clean/alias/map fields; those
    are read via ``getattr`` with safe defaults so legacy rows keep working.
    """
    from ..types import QueryBuilderJSON

    return Transform(
        id=record.id,
        name=record.name,
        condition_json=(QueryBuilderJSON.from_dict(record.condition_json) if record.condition_json else None),
        condition_sql=record.condition_sql,
        description=record.description,
        status=record.status,
        transform_type=getattr(record, "transform_type", "filter"),
        target_column=getattr(record, "target_column", None),
        expression_sql=getattr(record, "expression_sql", None),
        expression_config=getattr(record, "expression_config", None),
        created_at=getattr(record, "created_at", None),
    )


@dataclass(frozen=True, slots=True)
class Dataset:
    """Dataset domain model (authoritative business object).

    Responsibilities:
    - Identity and metadata (id, project_id, name, description, schema, transforms)
    - ORM/dict coercion (``from_record``, ``__post_init__``)
    - Storage path derivation (``storage_path`` / ``_s3_path``)
    - SQL surfaces (``staging_sql`` / ``display_sql``) — compiled by :mod:`dataset_sql`
    - Preview-row execution (``query_preview_rows``) against the shared query engine
    - HTTP serialization (``serialize``)

    No persistence concerns — that belongs to the repository layer.
    """

    id: str  # UUID primary key
    project_id: str | None = None  # Parent project UUID
    name: str = "New Dataset"  # Display name (business default)
    description: str | None = None  # Optional description
    schema_config: dict[str, Any] = field(
        default_factory=dict
    )  # Column names + types — drives query builder, table UI, and SQL generation
    partition_fields: list[str] = field(default_factory=list)  # Hive-style partition field names
    transforms: list[Transform] | list[dict[str, Any]] | None = field(default_factory=list)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
    column_profiles: dict[str, Any] | None = (
        None  # Per-column value stats (sample values, min/max, …) — injected into LLM system prompt
    )
    format_context: str | None = None  # Plugin-provided context for LLM (e.g., HL7v2 column conventions)
    row_count: int | None = None  # Total row count snapshotted at ingestion (None for legacy datasets)
    display_name: str | None = (
        None  # MR-6: editable source display name; UI falls back to ``name`` (filename untouched)
    )
    archived_at: str | None = None  # MR-7: cold-storage timestamp (ISO); None when live
    retention_until: str | None = None  # MR-7: retention end (ISO) = archived_at + 90d; None when live
    source_id: str | None = None  # Source aggregate link — the Source this dataset is the SELECT * view over

    @classmethod
    def from_record(
        cls,
        record: Any,
        preview_rows: list[dict[str, Any]] | None = None,
        include_transforms: bool = True,
    ) -> "Dataset":
        """Create Dataset domain object from ORM record."""

        return cls(
            id=record.id,
            project_id=record.project_id,
            name=record.name,
            description=record.description,
            schema_config=record.schema_config or {},
            partition_fields=record.partition_fields or [],
            transforms=record.transforms if include_transforms else [],
            preview_rows=preview_rows or [],
            column_profiles=record.column_profiles,
            format_context=getattr(record, "format_context", None),
            row_count=getattr(record, "row_count", None),
            display_name=getattr(record, "display_name", None),
            archived_at=_iso_or_none(getattr(record, "archived_at", None)),
            retention_until=_iso_or_none(getattr(record, "retention_until", None)),
            source_id=getattr(record, "source_id", None),
        )

    @property
    def transforms_to_delete(self) -> list[Transform]:
        """Transforms marked for deletion."""
        return [t for t in self.transforms if t.status == "deleted"]

    @property
    def storage_path(self) -> str:
        """Storage path prefix for S3/MinIO (e.g., ``datasets/proj-123/ds-456/``).

        Pattern: ``datasets/{project_id}/{dataset_id}/``. The trailing slash
        signals partitioned parquet storage (see ``_s3_path`` glob expansion).
        """
        return f"datasets/{self.project_id}/{self.id}/"

    def __post_init__(self) -> None:
        """Coerce the ``transforms`` input into ``list[Transform]``.

        The field accepts three shapes: ``None`` / empty list, a list of plain
        dicts (JSON payload), or a list of ORM records. Transform objects
        themselves are left untouched (no arm matches, list passes through).
        """
        match self.transforms:
            case None | []:
                object.__setattr__(self, "transforms", [])
            case [{}, *_rest]:
                object.__setattr__(
                    self,
                    "transforms",
                    [_transform_from_dict(t) for t in self.transforms],
                )
            case [obj, *_rest] if hasattr(obj, "_sa_instance_state"):
                object.__setattr__(
                    self,
                    "transforms",
                    [_transform_from_orm(t) for t in self.transforms],
                )

    def _s3_path(self) -> str:
        """S3 path for the parquet file(s).

        For partitioned storage (``storage_path`` ends with ``/``), returns a
        ``**/*.parquet`` glob pattern so downstream readers pick up every part.
        """
        from ..config import get_settings

        settings = get_settings()
        base_path = f"s3://{settings.storage_bucket}/{self.storage_path}"
        if self.storage_path and self.storage_path.endswith("/"):
            return f"{base_path}**/*.parquet"
        return base_path

    @property
    def staging_sql(self) -> SQLQuery:
        """Compact DuckDB SQL for query execution (no pretty printing)."""
        return dataset_sql.build_staging_sql(self.name, self.schema_config, self.transforms)

    @property
    def display_sql(self) -> SQLQuery:
        """Human-readable DuckDB SQL with dataset-derived alias and explicit columns."""
        return dataset_sql.build_display_sql(self.name, self.schema_config, self.transforms)

    async def query_preview_rows(self, limit: int = 10) -> list[dict[str, Any]]:
        """Execute the staging SQL (with transforms) via the query engine and return preview rows."""
        import io
        import json as _json

        from ..database import get_query_engine_pool
        from ..utils.sql_functions import ALL_MACROS

        staging = self.staging_sql
        if staging.startswith("-- Error"):
            return []

        s3_path = self._s3_path()
        # Ibis emits ``FROM "<dataset.name>"`` (the table is built by name);
        # rebind that to read_parquet so the transform composition runs
        # against the actual stored data.
        transformed_sql = staging.replace(f'"{self.name}"', f"read_parquet('{s3_path}')", 1)

        pool = await get_query_engine_pool()
        async with pool.acquire() as conn:
            if self._needs_custom_case_macros():
                for macro_sql in ALL_MACROS:
                    # CREATE MACRO is DuckDB DDL; Postgres's parser rejects it.
                    # pg_duckdb exposes duckdb.raw_query() to run DuckDB DDL
                    # against the per-connection DuckDB instance. Macros only
                    # persist for the lifetime of this connection.
                    await conn.execute("SELECT duckdb.raw_query($1)", macro_sql)

            # pg_duckdb's planner only binds ``to_json(t)`` to the *direct*
            # read_parquet alias, and asyncpg's mandatory prepared-statement
            # Describe phase rejects DuckDB's UNKNOWN type from
            # ``duckdb.query()``. Route through COPY TO STDOUT instead — the
            # COPY protocol streams text without Describe, and DuckDB
            # natively executes the inner query (transforms applied) inside
            # ``duckdb.query()``.
            inner = f"SELECT CAST(to_json(t) AS VARCHAR) AS row FROM ({transformed_sql}) t LIMIT {limit}"
            buf = io.BytesIO()
            await conn.copy_from_query(
                "SELECT (r['row'])::text FROM duckdb.query($1) r",
                inner,
                output=buf,
            )
            return [_json.loads(line) for line in buf.getvalue().decode().splitlines() if line]

    def _needs_custom_case_macros(self) -> bool:
        """True if any enabled clean/map transform uses a custom case mode
        (``title``/``snake``/``kebab``) not supported natively by DuckDB."""
        return any(
            t.is_enabled
            and t.transform_type in ("clean", "map")
            and t.expression_config
            and t.expression_config.get("operation") == "case"
            and t.expression_config.get("mode") in _CUSTOM_CASE_MODES
            for t in self.transforms
        )

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "schema_config": self.schema_config,
            "partition_fields": self.partition_fields,
            "transforms": ([t.serialize() for t in self.transforms] if self.transforms else []),
            "preview_rows": self.preview_rows,
            "column_profiles": self.column_profiles,
            "format_context": self.format_context,
            "row_count": self.row_count,
            "display_name": self.display_name,
            "archived_at": self.archived_at,
            "retention_until": self.retention_until,
            "source_id": self.source_id,
            "staging_sql": self.display_sql,
        }

    @staticmethod
    def display_name_to_filename(display_name: str) -> str:
        """Convert display name to snake_case filename.

        Args:
            display_name: Human-readable dataset name

        Returns:
            Safe filename in snake_case format
        """
        # Convert to lowercase and replace non-alphanumeric with underscore
        safe_name = re.sub(r"[^a-z0-9]+", "_", display_name.lower()).strip("_")
        return safe_name or "dataset"
