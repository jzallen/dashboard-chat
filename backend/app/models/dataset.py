"""Dataset domain model - authoritative business object.

This module contains the Dataset domain model with business logic for
generating aggregated SQL queries from transforms using Ibis expressions.
"""

from dataclasses import dataclass, field
from typing import Any
import re
from unittest import case

import ibis

from .transform import Transform
from ..types import SQLQuery


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
    name: str | None = None  # Display name
    description: str | None = None  # Optional description
    schema_config: dict[str, Any] = field(default_factory=dict)  # Field definitions for query builder
    partition_fields: list[str] = field(default_factory=list)  # Hive-style partition field names
    transforms: list[Transform] | list[dict[str, Any]] | None = field(default_factory=list)
    preview_rows: list[dict[str, Any]] = field(default_factory=list)

    @property
    def transforms_to_delete(self) -> list[Transform]:
        """Transforms marked for deletion."""
        return [t for t in self.transforms if t.status == 'deleted']

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
                object.__setattr__(self, 'transforms', [])
            case [{}, *rest]:
                converted = [
                    Transform(
                        id=t.get("id"),
                        name=t["name"],
                        condition_json=QueryBuilderJSON.from_dict(t["condition_json"]) if t.get("condition_json") else None,
                        condition_sql=t.get("condition_sql"),
                        description=t.get("description"),
                        status=t.get("status", "enabled"),
                    )
                    for t in self.transforms
                ]
                object.__setattr__(self, 'transforms', converted)
            case [obj, *rest] if hasattr(obj, '_sa_instance_state'):
                # iterable of TransformRecord ORM objects - convert to Transform domain objects
                converted = [
                    Transform(
                        id=t.id,
                        name=t.name,
                        condition_json=QueryBuilderJSON.from_dict(t.condition_json) if t.condition_json else None,
                        condition_sql=t.condition_sql,
                        description=t.description,
                        status=t.status,
                    )
                    for t in self.transforms
                ]
                object.__setattr__(self, 'transforms', converted)


    def _get_connection(self) -> ibis.BaseBackend:
        """Get Ibis DuckDB connection configured for S3/MinIO access."""
        from ..config import get_settings

        settings = get_settings()
        conn = ibis.duckdb.connect()

        if settings.storage_type == "minio":
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_endpoint='{settings.minio_endpoint}';
                SET s3_access_key_id='{settings.minio_access_key}';
                SET s3_secret_access_key='{settings.minio_secret_key}';
                SET s3_use_ssl={'true' if settings.minio_secure else 'false'};
                SET s3_url_style='path';
            """)
        else:
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_region='{settings.s3_region}';
            """)

        return conn

    def _s3_path(self) -> str:
        """S3 path for the parquet file(s).

        For partitioned data (storage_path ending with /), returns glob pattern.
        """
        from ..config import get_settings
        settings = get_settings()
        base_path = f"s3://{settings.storage_bucket}/{self.storage_path}"

        # For partitioned data, use glob pattern to read all parquet files
        if self.storage_path and self.storage_path.endswith('/'):
            return f"{base_path}**/*.parquet"

        return base_path

    def _build_table(self, table_name: str | None = None) -> ibis.Table:
        """Build Ibis table with filters applied.

        Args:
            table_name: Optional name for FROM clause (used by display_sql)
        """
        conn = self._get_connection()
        table = conn.read_parquet(self._s3_path(), table_name=table_name)

        # Select columns from schema
        fields = self.schema_config.get("fields", {})
        if fields:
            table = table.select(*fields.keys())

        # Apply active transform filters
        active_filters = [
            t.condition_json.as_ibis_filter(table)
            for t in self.transforms
            if t.is_enabled and t.condition_json
        ]
        if active_filters:
            table = table.filter(*active_filters)

        return table

    def _table_alias(self) -> str:
        """Lowercase initials of dataset name for SQL alias."""
        return "".join(word[0].lower() for word in self.name.split() if word)

    @property
    def staging_sql(self) -> SQLQuery:
        """SQL for query execution (compact, with S3 path)."""
        try:
            return ibis.to_sql(self._build_table(), dialect="duckdb", pretty=False)
        except Exception as e:
            return f"-- Error generating SQL: {str(e)}"

    @property
    def display_sql(self) -> SQLQuery:
        """Human-readable SQL with dataset name and alias."""
        try:
            table = self._build_table(table_name=self.name)
            sql = ibis.to_sql(table, dialect="duckdb", pretty=True)
        except Exception as e:
            return f"-- Error generating SQL: {str(e)}"

        alias = self._table_alias()

        # Replace "t0" with meaningful alias
        sql = sql.replace('"t0"', alias)

        # Remove quotes around column names: sp."col" -> sp.col
        sql = re.sub(rf'{alias}\."(\w+)"', rf'{alias}.\1', sql)

        # Expand SELECT * to explicit columns
        if "SELECT\n  *\n" in sql:
            fields = self.schema_config.get("fields", {})
            if fields:
                col_list = ",\n  ".join(f"{alias}.{col}" for col in fields.keys())
                sql = sql.replace("SELECT\n  *\n", f"SELECT\n  {col_list}\n")

        return sql

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
