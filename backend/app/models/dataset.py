"""Dataset domain model - authoritative business object.

This module contains the Dataset domain model with business logic for
generating aggregated SQL queries from transforms using Ibis expressions.
SQL generation uses Ibis as a compiler (no database connection needed).
Actual query execution goes through the shared query engine via asyncpg.
"""

import re
from dataclasses import dataclass, field
from typing import Any

import ibis

from ..types import CleaningExpression, SQLQuery
from .transform import Transform

# Maps dataset schema_config "type" values to ibis/duckdb type names.
_SCHEMA_TYPE_MAP = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
}

# Ibis's default table alias in rendered SQL. display_sql post-processes this
# into a human-readable initials-based alias (e.g. "Customer Purchase" -> "cp").
_DEFAULT_IBIS_TABLE_ALIAS = "t0"

# Case-conversion modes that require the project's custom DuckDB macros
# (title/snake/kebab are not built-in to DuckDB's SQL dialect).
_CUSTOM_CASE_MODES = frozenset({"title", "snake", "kebab"})


def _transform_from_dict(payload: dict[str, Any]) -> Transform:
    """Build a ``Transform`` from a plain JSON-shaped dict payload."""
    from ..types import QueryBuilderJSON

    raw_condition = payload.get("condition_json")
    return Transform(
        id=payload.get("id"),
        name=payload["name"],
        condition_json=(
            QueryBuilderJSON.from_dict(raw_condition) if raw_condition else None
        ),
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
        condition_json=(
            QueryBuilderJSON.from_dict(record.condition_json)
            if record.condition_json
            else None
        ),
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

    Business rules:
    - Aggregates transform filters into SQL queries via Ibis
    - Manages dataset schema and metadata
    - No database/persistence concerns (that's the repository's job)
    """

    id: str  # UUID primary key
    project_id: str | None = None  # Parent project UUID
    name: str = "New Dataset"  # Display name (business default)
    description: str | None = None  # Optional description
    schema_config: dict[str, Any] = field(
        default_factory=dict
    )  # Column names + types — drives query builder, table UI, and SQL generation
    partition_fields: list[str] = field(
        default_factory=list
    )  # Hive-style partition field names
    transforms: list[Transform] | list[dict[str, Any]] | None = field(
        default_factory=list
    )
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
    column_profiles: dict[str, Any] | None = (
        None  # Per-column value stats (sample values, min/max, …) — injected into LLM system prompt
    )
    format_context: str | None = (
        None  # Plugin-provided context for LLM (e.g., HL7v2 column conventions)
    )

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

        For partitioned data (storage_path ending with /), returns glob pattern.
        """
        from ..config import get_settings

        settings = get_settings()
        base_path = f"s3://{settings.storage_bucket}/{self.storage_path}"

        # For partitioned data, use glob pattern to read all parquet files
        if self.storage_path and self.storage_path.endswith("/"):
            return f"{base_path}**/*.parquet"

        return base_path

    def _build_table(self, table_name: str | None = None) -> ibis.Table:
        """Build Ibis table with three-stage pipeline (for SQL generation only).

        Pipeline stages (design D3):
        1. MUTATE — apply cleaning transforms as column expressions via .mutate()
        2. FILTER — apply filter transforms as WHERE clauses via .filter()
        3. RENAME — apply alias transforms as column renames via .rename()

        Uses schema_config to build table expression (no database connection needed).

        Args:
            table_name: Optional name for FROM clause (used by display_sql)
        """
        table = self._build_table_from_schema(table_name)

        # Select columns from schema
        fields = self.schema_config.get("fields", {})
        if fields:
            table = table.select(*fields.keys())

        # Stage 1: MUTATE — apply cleaning transforms sorted by created_at
        cleaning_transforms = sorted(
            [
                t
                for t in self.transforms
                if t.is_enabled
                and t.transform_type in ("clean", "map")
                and t.expression_config
            ],
            key=lambda t: getattr(t, "created_at", "") or "",
        )
        for t in cleaning_transforms:
            expr = CleaningExpression(t.expression_config)
            table = table.mutate(
                **{t.target_column: expr.as_ibis_expr(table, t.target_column)}
            )

        # Stage 2: FILTER — apply filter transforms as WHERE clauses (existing behavior)
        active_filters = [
            t.condition_json.as_ibis_filter(table)
            for t in self.transforms
            if t.is_enabled and t.transform_type == "filter" and t.condition_json
        ]
        if active_filters:
            table = table.filter(*active_filters)

        # Stage 3: RENAME — apply alias transforms as column renames
        alias_renames = {}
        for t in self.transforms:
            if t.is_enabled and t.transform_type == "alias" and t.expression_config:
                expr = CleaningExpression(t.expression_config)
                if expr.alias_name:
                    alias_renames[expr.alias_name] = t.target_column
        if alias_renames:
            table = table.rename(alias_renames)

        return table

    def _build_table_from_schema(self, table_name: str | None = None) -> ibis.Table:
        """Build Ibis table expression from schema_config (no S3 read needed)."""
        fields = self.schema_config.get("fields", {})
        if not fields:
            raise ValueError("No data or schema available for this dataset")

        ibis_schema = {
            name: _SCHEMA_TYPE_MAP.get(info.get("type", "text"), "string")
            for name, info in fields.items()
        }
        return ibis.table(ibis_schema, name=table_name or self.name)

    def _table_alias(self) -> str:
        """Lowercase initials of dataset name for SQL alias."""
        return "".join(word[0].lower() for word in self.name.split() if word)

    @property
    def staging_sql(self) -> SQLQuery:
        """SQL for query execution (compact, with S3 path)."""
        try:
            return ibis.to_sql(self._build_table(), dialect="duckdb", pretty=False)
        except Exception as e:
            return f"-- Error generating SQL: {e!s}"

    @property
    def display_sql(self) -> SQLQuery:
        """Human-readable SQL with dataset-derived alias and expanded SELECT *."""
        try:
            table = self._build_table(table_name=self.name)
            sql = ibis.to_sql(table, dialect="duckdb", pretty=True)
        except Exception as e:
            return f"-- Error generating SQL: {e!s}"

        alias = self._table_alias()
        sql = sql.replace(f'"{_DEFAULT_IBIS_TABLE_ALIAS}"', alias)
        # Remove quotes around bare column refs: ``sp."col"`` -> ``sp.col``.
        sql = re.sub(rf'{alias}\."(\w+)"', rf"{alias}.\1", sql)
        return self._expand_select_star(sql, alias)

    def _expand_select_star(self, sql: str, alias: str) -> str:
        """Replace pretty-printed ``SELECT *`` with the explicit column list."""
        if "SELECT\n  *\n" not in sql:
            return sql
        fields = self.schema_config.get("fields", {})
        if not fields:
            return sql
        col_list = ",\n  ".join(f"{alias}.{col}" for col in fields)
        return sql.replace("SELECT\n  *\n", f"SELECT\n  {col_list}\n")

    async def query_preview_rows(self, limit: int = 10) -> list[dict[str, Any]]:
        """Execute the staging SQL (with transforms) via the query engine and return preview rows."""
        from ..database import get_query_engine_pool
        from ..repositories.lake._pg_duckdb_query import (
            build_read_parquet_preview_query,
            decode_wrapped_rows,
        )
        from ..utils.sql_functions import ALL_MACROS

        staging = self.staging_sql
        if staging.startswith("-- Error"):
            return []

        s3_path = self._s3_path()

        pool = await get_query_engine_pool()
        async with pool.acquire() as conn:
            if self._needs_custom_case_macros():
                for macro_sql in ALL_MACROS:
                    await conn.execute(macro_sql)

            rows = await conn.fetch(build_read_parquet_preview_query(s3_path, limit))
            return decode_wrapped_rows(rows)

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
            "transforms": (
                [t.serialize() for t in self.transforms] if self.transforms else []
            ),
            "preview_rows": self.preview_rows,
            "column_profiles": self.column_profiles,
            "format_context": self.format_context,
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
