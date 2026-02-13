"""Lake repository implementations for Parquet data lake operations.

This module handles reading and writing Parquet files to MinIO/S3 storage.
"""

import json
import logging
import os
import re
import shutil
import tempfile
from pathlib import Path
from abc import ABC, abstractmethod
from functools import wraps
from typing import Any, Callable, TypeVar, ParamSpec

import boto3
import ibis
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from ..exceptions import LakeRepositoryError
from ...config import get_settings

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


class BaseLakeRepository(ABC):
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

    @abstractmethod
    def _configure_duckdb_s3(self, conn: ibis.BaseBackend) -> None:
        """Configure DuckDB for S3 access. Implemented by subclasses."""
        ...

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
            Bucket=self.bucket,
            Key=storage_path,
            Body=content,
            ContentType='application/octet-stream'
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
        response = self.s3_client.get_object(
            Bucket=self.bucket,
            Key=storage_path
        )
        return response['Body'].read()

    @staticmethod
    def _validate_identifier(name: str) -> str:
        """Validate a SQL identifier (column/field name) to prevent injection.

        Only allows alphanumeric characters and underscores.

        Raises:
            ValueError: If the identifier contains invalid characters.
        """
        if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', name):
            raise ValueError(f"Invalid identifier: {name!r}")
        return name

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
        conn = ibis.duckdb.connect()

        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        temp_out_dir = tempfile.mkdtemp()

        try:
            if partition_fields:
                safe_fields = [self._validate_identifier(f) for f in partition_fields]
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
                    ContentType='application/octet-stream',
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
        conn = ibis.duckdb.connect()
        self._configure_duckdb_s3(conn)

        s3_path = f"s3://{self.bucket}/{storage_path}"

        # For partitioned data (path ending with /), use glob pattern
        if storage_path.endswith('/'):
            s3_path = f"{s3_path}**/*.parquet"

        table = conn.read_parquet(s3_path)
        df = table.limit(limit).execute()

        # Use pandas JSON serialization to handle date/datetime types,
        # then parse back to get plain Python dicts
        return json.loads(df.to_json(orient='records', date_format='iso'))

    @handle_repository_exceptions
    def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file(s).

        Supports both single parquet files and partitioned datasets.

        Args:
            storage_path: Path within bucket (use trailing '/' for partitioned data)

        Returns:
            Number of rows in the Parquet file(s)
        """
        conn = ibis.duckdb.connect()
        self._configure_duckdb_s3(conn)

        s3_path = f"s3://{self.bucket}/{storage_path}"

        # For partitioned data (path ending with /), use glob pattern
        if storage_path.endswith('/'):
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
            self.s3_client.delete_object(
                Bucket=self.bucket,
                Key=storage_path
            )
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "404" or error_code == "NoSuchKey":
                logger.debug("Object already deleted: %s", storage_path)
            else:
                logger.error("Failed to delete %s: %s", storage_path, e)
                raise


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
                's3',
                endpoint_url=f"http://{settings.minio_endpoint}",
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': settings.s3_max_retries, 'mode': 'standard'},
                    connect_timeout=settings.s3_connect_timeout,
                    read_timeout=settings.s3_read_timeout,
                ),
            )

        super().__init__(s3_client, settings.storage_bucket)
        self._settings = settings

    def _configure_duckdb_s3(self, conn: ibis.BaseBackend) -> None:
        """Configure DuckDB for MinIO access."""
        endpoint = self._settings.minio_endpoint.replace("'", "''")
        access_key = (self._settings.minio_access_key or "").replace("'", "''")
        secret_key = (self._settings.minio_secret_key or "").replace("'", "''")
        use_ssl = 'true' if self._settings.minio_secure else 'false'
        conn.raw_sql(f"""
            INSTALL httpfs;
            LOAD httpfs;
            SET s3_endpoint='{endpoint}';
            SET s3_access_key_id='{access_key}';
            SET s3_secret_access_key='{secret_key}';
            SET s3_use_ssl={use_ssl};
            SET s3_url_style='path';
        """)
