"""Lake repository implementations for Parquet data lake operations.

This module handles reading and writing Parquet files to MinIO/S3 storage.
Analytical reads go through the shared query engine (PostgreSQL + pg_duckdb)
via asyncpg, while writes use boto3 directly.
"""

import logging
import os
import shutil
import tempfile
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any, ParamSpec, TypeVar

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from ...config import get_settings
from ...utils.sql_safety import validate_identifier
from ..exceptions import LakeRepositoryError
from ._pg_duckdb_query import build_read_parquet_preview_query, decode_wrapped_rows

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


def handle_repository_exceptions(func: Callable[P, R]) -> Callable[P, R]:
    """Decorator that wraps BotoCoreError/ClientError as LakeRepositoryError."""

    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return func(*args, **kwargs)
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e

    return wrapper


class BaseLakeRepository:
    """Base repository for Parquet data lake operations.

    Writes: boto3 to S3-compatible storage
    Reads: asyncpg to shared query engine (PostgreSQL + pg_duckdb)
    """

    def __init__(self, s3_client, bucket: str):
        """Initialize with S3 client and bucket name.

        Args:
            s3_client: boto3 S3 client
            bucket: Storage bucket name
        """
        self.s3_client = s3_client
        self.bucket = bucket

    async def _get_query_engine_pool(self):
        """Get the asyncpg connection pool to the query engine."""
        from ...database import get_query_engine_pool

        return await get_query_engine_pool()

    @handle_repository_exceptions
    def write_raw_file(self, content: bytes, storage_path: str) -> str:
        """Store raw file to S3 without transformation.

        Args:
            content: Raw file bytes
            storage_path: Path within bucket (e.g., "uploads/project_id/file.csv")

        Returns:
            S3 path (s3://bucket/path)
        """
        self.s3_client.put_object(
            Bucket=self.bucket, Key=storage_path, Body=content, ContentType="application/octet-stream"
        )
        return f"s3://{self.bucket}/{storage_path}"

    @handle_repository_exceptions
    def read_raw_file(self, storage_path: str) -> bytes:
        """Read raw file from S3 storage.

        Args:
            storage_path: Path within bucket

        Returns:
            File content as bytes
        """
        response = self.s3_client.get_object(Bucket=self.bucket, Key=storage_path)
        return response["Body"].read()

    @handle_repository_exceptions
    def write_csv_as_partitioned_parquet(
        self,
        csv_content: bytes,
        storage_prefix: str,
        partition_fields: list[str],
    ) -> str:
        """Convert CSV to partitioned Parquet files using hive-style partitioning.

        Uses the query engine (pg_duckdb) for CSV-to-Parquet conversion when no
        partitioning is needed. For partitioned writes, uses a local DuckDB
        connection since COPY TO with PARTITION_BY requires local filesystem access.

        For non-partitioned data, writes locally via the query engine, then uploads
        to S3 via boto3.

        Args:
            csv_content: Raw CSV bytes
            storage_prefix: Base path within bucket (e.g., "datasets/project_id/dataset_id/")
            partition_fields: List of field names to partition by (e.g., ["date", "region"])

        Returns:
            S3 path prefix (s3://bucket/prefix)

        Creates files like:
            datasets/project_id/dataset_id/date=2024-01-01/region=US/part-0.parquet
            datasets/project_id/dataset_id/date=2024-01-01/region=EU/part-0.parquet
        """
        # CSV-to-Parquet conversion needs local filesystem for tempfiles.
        # Use a local in-process DuckDB for this (no S3 access needed).
        import duckdb

        with tempfile.NamedTemporaryFile(mode="wb", suffix=".csv", delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        temp_out_dir = tempfile.mkdtemp()

        try:
            conn = duckdb.connect()

            if partition_fields:
                safe_fields = [validate_identifier(f) for f in partition_fields]
                partition_by_clause = ", ".join(safe_fields)
                conn.execute(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{temp_out_dir}' (
                        FORMAT PARQUET,
                        PARTITION_BY ({partition_by_clause}),
                        OVERWRITE_OR_IGNORE true
                    );
                """)
            else:
                conn.execute(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{temp_out_dir}/data.parquet' (FORMAT PARQUET);
                """)

            conn.close()

            # Upload all generated parquet files to S3
            temp_out_path = Path(temp_out_dir)
            for local_path in temp_out_path.rglob("*.parquet"):
                s3_key = f"{storage_prefix}{local_path.relative_to(temp_out_path)}"
                self.s3_client.put_object(
                    Bucket=self.bucket,
                    Key=s3_key,
                    Body=local_path.read_bytes(),
                    ContentType="application/octet-stream",
                )

            return f"s3://{self.bucket}/{storage_prefix}"
        finally:
            if os.path.exists(temp_csv_path):
                os.unlink(temp_csv_path)
            shutil.rmtree(temp_out_dir, ignore_errors=True)

    def _build_s3_path(self, storage_path: str) -> str:
        """Build the full S3 path for reading Parquet data."""
        s3_path = f"s3://{self.bucket}/{storage_path}"
        if storage_path.endswith("/"):
            s3_path = f"{s3_path}**/*.parquet"
        return s3_path

    async def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict[str, Any]]:
        """Read preview rows from Parquet via the query engine.

        Supports both single parquet files and partitioned datasets.
        For partitioned data, use storage_path ending with '/' to read all partitions.

        Args:
            storage_path: Path within bucket (use trailing '/' for partitioned data)
            limit: Number of rows to return

        Returns:
            List of row dictionaries
        """
        s3_path = self._build_s3_path(storage_path)
        pool = await self._get_query_engine_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(build_read_parquet_preview_query(s3_path, limit))
            return decode_wrapped_rows(rows)

    async def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file(s).

        Supports both single parquet files and partitioned datasets.

        Args:
            storage_path: Path within bucket (use trailing '/' for partitioned data)

        Returns:
            Number of rows in the Parquet file(s)
        """
        s3_path = self._build_s3_path(storage_path)
        pool = await self._get_query_engine_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(f"SELECT COUNT(*) AS cnt FROM read_parquet('{s3_path}')")
            return int(row["cnt"])

    @handle_repository_exceptions
    def delete_parquet(self, storage_path: str) -> None:
        """Delete Parquet file from storage.

        Args:
            storage_path: Path within bucket
        """
        try:
            self.s3_client.delete_object(Bucket=self.bucket, Key=storage_path)
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "404" or error_code == "NoSuchKey":
                logger.debug("Object already deleted: %s", storage_path)
            else:
                logger.error("Failed to delete %s: %s", storage_path, e)
                raise

    async def get_parquet_column_type(self, storage_path: str, column: str) -> str:
        """Get the data type name for a column from Parquet schema.

        Args:
            storage_path: Path within bucket
            column: Column name

        Returns:
            String representation of the column's data type (e.g., 'VARCHAR', 'DOUBLE')
        """
        s3_path = self._build_s3_path(storage_path)
        pool = await self._get_query_engine_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(f"SELECT typeof(\"{column}\") AS col_type FROM read_parquet('{s3_path}') LIMIT 1")
            return str(row["col_type"]).lower()

    async def preview_cleaning_operation(
        self,
        s3_path: str,
        target_column: str,
        expression_config: dict,
        sample_limit: int,
    ) -> dict:
        """Async implementation of preview_cleaning_operation."""
        from ...utils.sql_safety import quote_ident, quote_literal

        col = quote_ident(target_column)
        operation = expression_config["operation"]

        # Build the "after" expression and affected predicate SQL per operation type
        if operation == "trim":
            after_expr = f"TRIM({col})"
            affected_pred = f"{col} != TRIM({col})"
        elif operation == "case":
            mode = expression_config["mode"]
            if mode == "upper":
                after_expr = f"UPPER({col})"
                affected_pred = f"{col} != UPPER({col})"
            elif mode == "lower":
                after_expr = f"LOWER({col})"
                affected_pred = f"{col} != LOWER({col})"
            elif mode == "title":
                after_expr = f"title_case({col})"
                affected_pred = f"{col} != title_case({col})"
            elif mode == "snake":
                after_expr = f"snake_case({col})"
                affected_pred = f"{col} != snake_case({col})"
            elif mode == "kebab":
                after_expr = f"kebab_case({col})"
                affected_pred = f"{col} != kebab_case({col})"
            else:
                raise ValueError(f"Invalid case mode: {mode}")
        elif operation == "fill_null":
            fill_value = expression_config["fill_value"]
            fill_literal = quote_literal(fill_value) if isinstance(fill_value, str) else str(fill_value)
            after_expr = f"COALESCE({col}, {fill_literal})"
            affected_pred = f"({col} IS NULL OR CAST({col} AS VARCHAR) = '')"
        elif operation == "map_values":
            mappings = expression_config.get("mappings", [])
            source_values = [quote_literal(m["from"]) for m in mappings]
            case_whens = " ".join(
                f"WHEN {col} = {quote_literal(m['from'])} THEN {quote_literal(m['to'])}" for m in mappings
            )
            after_expr = f"CASE {case_whens} ELSE {col} END" if mappings else col
            affected_pred = f"{col} IN ({', '.join(source_values)})" if source_values else "FALSE"
        else:
            raise ValueError(f"Unsupported preview operation: {operation}")

        pool = await self._get_query_engine_pool()
        async with pool.acquire() as conn:
            # Register custom macros needed for title_case, snake_case, kebab_case
            if operation == "case" and expression_config.get("mode") in ("title", "snake", "kebab"):
                from ...utils.sql_functions import ALL_MACROS

                for macro_sql in ALL_MACROS:
                    await conn.execute(macro_sql)

            # Get total count
            total_row = await conn.fetchrow(f"SELECT COUNT(*) AS cnt FROM read_parquet('{s3_path}')")
            total_count = int(total_row["cnt"])

            # Get column type
            type_row = await conn.fetchrow(f"SELECT typeof({col}) AS col_type FROM read_parquet('{s3_path}') LIMIT 1")
            column_type = str(type_row["col_type"]).lower()

            # Count affected rows
            affected_row = await conn.fetchrow(
                f"SELECT COUNT(*) AS cnt FROM read_parquet('{s3_path}') WHERE {affected_pred}"
            )
            affected_count = int(affected_row["cnt"])

            # Get sample before/after pairs.
            #
            # We issue two single-column queries (before, after) instead of a
            # single multi-column projection because pg_duckdb's Describe
            # phase reports a single column for ``read_parquet`` regardless of
            # the actual projection — multi-column queries trip asyncpg's
            # protocol parser. Single-column queries are unaffected. The two
            # queries share an identical WHERE/LIMIT, so they return the same
            # row set in the same order (parquet read order is stable).
            samples = []
            if affected_count > 0:
                before_rows = await conn.fetch(
                    f"SELECT {col} AS val FROM read_parquet('{s3_path}') WHERE {affected_pred} LIMIT {sample_limit}"
                )
                after_rows = await conn.fetch(
                    f"SELECT {after_expr} AS val "
                    f"FROM read_parquet('{s3_path}') "
                    f"WHERE {affected_pred} "
                    f"LIMIT {sample_limit}"
                )
                samples = [
                    {"before": b["val"], "after": a["val"]} for b, a in zip(before_rows, after_rows, strict=False)
                ]

        return {
            "affected_count": affected_count,
            "total_count": total_count,
            "samples": samples,
            "column_type": column_type,
        }


class MinIOLakeRepository(BaseLakeRepository):
    """Lake repository for MinIO storage."""

    def __init__(self, s3_client=None):
        """Initialize MinIO lake repository.

        Args:
            s3_client: Optional boto3 S3 client. If not provided, creates one from settings.
        """
        settings = get_settings()

        if s3_client is None:
            s3_client = boto3.client(
                "s3",
                endpoint_url=f"http://{settings.minio_endpoint}",
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                config=Config(
                    signature_version="s3v4",
                    retries={"max_attempts": settings.s3_max_retries, "mode": "standard"},
                    connect_timeout=settings.s3_connect_timeout,
                    read_timeout=settings.s3_read_timeout,
                ),
            )

        super().__init__(s3_client, settings.storage_bucket)
        self._settings = settings
