"""Dataset domain model - authoritative business object.

This module contains the Dataset domain model with business logic for
generating aggregated SQL queries from transforms using Ibis expressions.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

import ibis

from ..types import CleaningExpression, SQLQuery
from .transform import Transform

_SCHEMA_TYPE_MAP = {
    "text": "string",
    "number": "float64",
    "boolean": "boolean",
    "select": "string",
}


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
    partition_fields: list[str] = field(default_factory=list)  # Hive-style partition field names
    transforms: list[Transform] | list[dict[str, Any]] | None = field(default_factory=list)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)
    column_profiles: dict[str, Any] | None = (
        None  # Per-column value stats (sample values, min/max, …) — injected into LLM system prompt
    )

    @classmethod
    def from_record(
        cls, record: Any, preview_rows: list[dict[str, Any]] | None = None, include_transforms: bool = True
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
        )

    @property
    def transforms_to_delete(self) -> list[Transform]:
        """Transforms marked for deletion."""
        return [t for t in self.transforms if t.status == "deleted"]

    @property
    def storage_path(self) -> str:
        """Compute the storage path for a dataset.

        Storage path follows the pattern: datasets/{project_id}/{dataset_id}/
        The trailing slash indicates partitioned parquet storage.

        Args:
            project_id: Project UUID
            dataset_id: Dataset UUID

        Returns:
            Storage path prefix for S3/MinIO (e.g., "datasets/proj-123/ds-456/")
        """
        return f"datasets/{self.project_id}/{self.id}/"

    def __post_init__(self) -> None:
        """Convert transform dicts to Transform domain objects."""
        from ..types import QueryBuilderJSON

        match self.transforms:
            case None | []:
                object.__setattr__(self, "transforms", [])
            case [{}, *_rest]:
                converted = [
                    Transform(
                        id=t.get("id"),
                        name=t["name"],
                        condition_json=QueryBuilderJSON.from_dict(t["condition_json"])
                        if t.get("condition_json")
                        else None,
                        condition_sql=t.get("condition_sql"),
                        description=t.get("description"),
                        status=t.get("status", "enabled"),
                        transform_type=t.get("transform_type", "filter"),
                        target_column=t.get("target_column"),
                        expression_sql=t.get("expression_sql"),
                        expression_config=t.get("expression_config"),
                        created_at=t.get("created_at"),
                    )
                    for t in self.transforms
                ]
                object.__setattr__(self, "transforms", converted)
            case [obj, *_rest] if hasattr(obj, "_sa_instance_state"):
                # iterable of TransformRecord ORM objects - convert to Transform domain objects
                converted = [
                    Transform(
                        id=t.id,
                        name=t.name,
                        condition_json=QueryBuilderJSON.from_dict(t.condition_json) if t.condition_json else None,
                        condition_sql=t.condition_sql,
                        description=t.description,
                        status=t.status,
                        transform_type=getattr(t, "transform_type", "filter"),
                        target_column=getattr(t, "target_column", None),
                        expression_sql=getattr(t, "expression_sql", None),
                        expression_config=getattr(t, "expression_config", None),
                        created_at=getattr(t, "created_at", None),
                    )
                    for t in self.transforms
                ]
                object.__setattr__(self, "transforms", converted)

    def _get_connection(self) -> ibis.BaseBackend:
        """Get Ibis DuckDB connection configured for S3/MinIO access."""
        from ..config import get_settings
        from ..utils.sql_functions import register_duckdb_macros

        settings = get_settings()
        conn = ibis.duckdb.connect()

        if settings.storage_type == "minio":
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_endpoint='{settings.minio_endpoint}';
                SET s3_access_key_id='{settings.minio_access_key}';
                SET s3_secret_access_key='{settings.minio_secret_key}';
                SET s3_use_ssl={"true" if settings.minio_secure else "false"};
                SET s3_url_style='path';
            """)
        else:
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_region='{settings.s3_region}';
            """)

        register_duckdb_macros(conn)
        return conn

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

    def _build_table(self, table_name: str | None = None, conn: ibis.BaseBackend | None = None) -> ibis.Table:
        """Build Ibis table with three-stage pipeline.

        Pipeline stages (design D3):
        1. MUTATE — apply cleaning transforms as column expressions via .mutate()
        2. FILTER — apply filter transforms as WHERE clauses via .filter()
        3. RENAME — apply alias transforms as column renames via .rename()

        Reads schema from parquet in S3 when available, otherwise falls back
        to building a table expression from schema_config.

        Args:
            table_name: Optional name for FROM clause (used by display_sql)
            conn: Optional Ibis backend connection (created if not provided)
        """
        try:
            if conn is None:
                conn = self._get_connection()
            table = conn.read_parquet(self._s3_path(), table_name=table_name)
        except Exception:
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
                if t.is_enabled and t.transform_type in ("clean", "map") and t.expression_config
            ],
            key=lambda t: getattr(t, "created_at", "") or "",
        )
        for t in cleaning_transforms:
            expr = CleaningExpression(t.expression_config)
            table = table.mutate(**{t.target_column: expr.as_ibis_expr(table, t.target_column)})

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

        ibis_schema = {name: _SCHEMA_TYPE_MAP.get(info.get("type", "text"), "string") for name, info in fields.items()}
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
        """Human-readable SQL with dataset name and alias."""
        try:
            table = self._build_table(table_name=self.name)
            sql = ibis.to_sql(table, dialect="duckdb", pretty=True)
        except Exception as e:
            return f"-- Error generating SQL: {e!s}"

        alias = self._table_alias()

        # Replace "t0" with meaningful alias
        sql = sql.replace('"t0"', alias)

        # Remove quotes around column names: sp."col" -> sp.col
        sql = re.sub(rf'{alias}\."(\w+)"', rf"{alias}.\1", sql)

        # Expand SELECT * to explicit columns
        if "SELECT\n  *\n" in sql:
            fields = self.schema_config.get("fields", {})
            if fields:
                col_list = ",\n  ".join(f"{alias}.{col}" for col in fields)
                sql = sql.replace("SELECT\n  *\n", f"SELECT\n  {col_list}\n")

        return sql

    def query_preview_rows(self, limit: int = 10) -> list[dict[str, Any]]:
        """Execute the staging SQL (with transforms) and return preview rows."""
        conn = self._get_connection()
        table = self._build_table(conn=conn)
        df = conn.execute(table.limit(limit))
        return json.loads(df.to_json(orient="records", date_format="iso"))

    def serialize(self) -> dict[str, Any]:
        """Serialize to JSON-compatible dict for HTTP responses."""
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "description": self.description,
            "schema_config": self.schema_config,
            "partition_fields": self.partition_fields,
            "transforms": [t.serialize() for t in self.transforms] if self.transforms else [],
            "preview_rows": self.preview_rows,
            "column_profiles": self.column_profiles,
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
