"""Lake repository implementations for Parquet data lake operations.

This module handles reading and writing Parquet files to MinIO/S3 storage.
"""

import json
import logging
import os
import shutil
import tempfile
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any, ParamSpec, TypeVar

import boto3
import ibis
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from ...config import get_settings
from ...utils.duckdb_factory import create_hardened_duckdb_connection
from ...utils.sql_functions import kebab_case, register_duckdb_macros, snake_case, title_case
from ...utils.sql_safety import validate_identifier
from ..exceptions import LakeRepositoryError

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
    Reads: Ibis + DuckDB
    """

    def __init__(self, s3_client, bucket: str):
        """Initialize with S3 client and bucket name.

        Args:
            s3_client: boto3 S3 client
            bucket: Storage bucket name
        """
        self.s3_client = s3_client
        self.bucket = bucket

    def _create_s3_connection(self) -> ibis.BaseBackend:
        """Create a hardened DuckDB connection with S3 configured.

        Delegates to the hardened factory which handles validation, escaping,
        and httpfs installation from application settings.
        """
        return create_hardened_duckdb_connection(configure_s3=True)

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

        Writes locally via DuckDB, then uploads to S3 via boto3.

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
        # EXCEPTION: This method needs local filesystem access (read_csv_auto, COPY TO)
        # for tempfile-to-tempdir conversion, so it cannot use the hardened factory
        # (which disables enable_external_access). All inputs are tempfile-generated
        # paths (not user-controlled) and partition_fields are validated via
        # validate_identifier() above. See sql-injection-guardrails spec.
        conn = ibis.duckdb.connect()

        with tempfile.NamedTemporaryFile(mode="wb", suffix=".csv", delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        temp_out_dir = tempfile.mkdtemp()

        try:
            if partition_fields:
                safe_fields = [validate_identifier(f) for f in partition_fields]
                partition_by_clause = ", ".join(safe_fields)
                conn.raw_sql(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{temp_out_dir}' (
                        FORMAT PARQUET,
                        PARTITION_BY ({partition_by_clause}),
                        OVERWRITE_OR_IGNORE true
                    );
                """)
            else:
                conn.raw_sql(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{temp_out_dir}/data.parquet' (FORMAT PARQUET);
                """)

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

    @handle_repository_exceptions
    def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict[str, Any]]:
        """Read preview rows from Parquet via DuckDB.

        Supports both single parquet files and partitioned datasets.
        For partitioned data, use storage_path ending with '/' to read all partitions.

        Args:
            storage_path: Path within bucket (use trailing '/' for partitioned data)
            limit: Number of rows to return

        Returns:
            List of row dictionaries
        """
        conn = self._create_s3_connection()

        s3_path = f"s3://{self.bucket}/{storage_path}"

        # For partitioned data (path ending with /), use glob pattern
        if storage_path.endswith("/"):
            s3_path = f"{s3_path}**/*.parquet"

        table = conn.read_parquet(s3_path)
        df = table.limit(limit).execute()

        # Use pandas JSON serialization to handle date/datetime types,
        # then parse back to get plain Python dicts
        return json.loads(df.to_json(orient="records", date_format="iso"))

    @handle_repository_exceptions
    def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file(s).

        Supports both single parquet files and partitioned datasets.

        Args:
            storage_path: Path within bucket (use trailing '/' for partitioned data)

        Returns:
            Number of rows in the Parquet file(s)
        """
        conn = self._create_s3_connection()

        s3_path = f"s3://{self.bucket}/{storage_path}"

        # For partitioned data (path ending with /), use glob pattern
        if storage_path.endswith("/"):
            s3_path = f"{s3_path}**/*.parquet"

        table = conn.read_parquet(s3_path)
        count = table.count().execute()

        return int(count)

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

    def _build_s3_path(self, storage_path: str) -> str:
        """Build the full S3 path for reading Parquet data."""
        s3_path = f"s3://{self.bucket}/{storage_path}"
        if storage_path.endswith("/"):
            s3_path = f"{s3_path}**/*.parquet"
        return s3_path

    @handle_repository_exceptions
    def get_parquet_column_type(self, storage_path: str, column: str) -> str:
        """Get the DuckDB type name for a column from Parquet schema.

        Args:
            storage_path: Path within bucket
            column: Column name

        Returns:
            String representation of the column's data type (e.g., 'string', 'float64')
        """
        conn = self._create_s3_connection()

        s3_path = self._build_s3_path(storage_path)
        table = conn.read_parquet(s3_path)
        return str(table.schema()[column])

    @handle_repository_exceptions
    def preview_cleaning_operation(
        self,
        storage_path: str,
        target_column: str,
        expression_config: dict,
        sample_limit: int = 5,
    ) -> dict:
        """Preview a cleaning operation against Parquet data via DuckDB.

        Builds per-operation affected-row predicates and before/after samples.

        Args:
            storage_path: Path within bucket
            target_column: Column to apply operation on
            expression_config: Cleaning operation config
            sample_limit: Max number of sample pairs to return

        Returns:
            Dict with affected_count, total_count, samples list, and column_type
        """
        conn = self._create_s3_connection()
        register_duckdb_macros(conn)

        s3_path = self._build_s3_path(storage_path)
        table = conn.read_parquet(s3_path)
        col = table[target_column]

        total_count = int(table.count().execute())
        column_type = str(table.schema()[target_column])

        operation = expression_config["operation"]

        # Build the "after" expression and affected predicate per operation type
        if operation == "trim":
            after_expr = col.strip()
            affected_pred = col != col.strip()
        elif operation == "case":
            mode = expression_config["mode"]
            if mode == "upper":
                after_expr = col.upper()
                affected_pred = col != col.upper()
            elif mode == "lower":
                after_expr = col.lower()
                affected_pred = col != col.lower()
            elif mode == "title":
                after_expr = title_case(col)
                affected_pred = col != title_case(col)
            elif mode == "snake":
                after_expr = snake_case(col)
                affected_pred = col != snake_case(col)
            elif mode == "kebab":
                after_expr = kebab_case(col)
                affected_pred = col != kebab_case(col)
            else:
                raise ValueError(f"Invalid case mode: {mode}")
        elif operation == "fill_null":
            fill_value = expression_config["fill_value"]
            after_expr = col.fill_null(fill_value)
            # Affected: NULL or empty string
            affected_pred = col.isnull() | (col.cast("string") == "")
        elif operation == "map_values":
            mappings = expression_config.get("mappings", [])
            source_values = [m["from"] for m in mappings]
            case_expr = ibis.case()
            for m in mappings:
                case_expr = case_expr.when(col == m["from"], m["to"])
            after_expr = case_expr.else_(col).end()
            affected_pred = col.isin(source_values)
        else:
            raise ValueError(f"Unsupported preview operation: {operation}")

        # Count affected rows
        affected_count = int(table.filter(affected_pred).count().execute())

        # Get sample before/after pairs
        samples = []
        if affected_count > 0:
            samples_table = table.filter(affected_pred).select(before=col, after=after_expr).limit(sample_limit)
            samples_df = samples_table.execute()
            samples = [{"before": row["before"], "after": row["after"]} for _, row in samples_df.iterrows()]

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
