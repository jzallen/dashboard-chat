"""Lake repository for Parquet data lake operations.

This repository handles reading and writing Parquet files to MinIO/S3 storage.
"""

import os
import tempfile
from abc import ABC, abstractmethod
from functools import wraps
from typing import Any, Callable, Protocol, TypeVar, ParamSpec

import boto3
import ibis
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .exceptions import LakeRepositoryError
from ..config import get_settings

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


class LakeRepository(Protocol):
    """Protocol for lake repository operations."""

    def write_csv_as_parquet(self, csv_content: bytes, storage_path: str) -> str:
        """Convert CSV to Parquet and upload to storage."""
        ...

    def write_raw_file(self, content: bytes, storage_path: str) -> str:
        """Store raw file to S3 without transformation."""
        ...

    def read_raw_file(self, storage_path: str) -> bytes:
        """Read raw file from S3 storage."""
        ...

    def write_csv_as_partitioned_parquet(
        self,
        csv_content: bytes,
        storage_prefix: str,
        partition_fields: list[str],
    ) -> str:
        """Convert CSV to partitioned Parquet files using hive-style partitioning."""
        ...

    def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict[str, Any]]:
        """Read preview rows from Parquet file."""
        ...

    def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file."""
        ...

    def delete_parquet(self, storage_path: str) -> None:
        """Delete Parquet file from storage."""
        ...


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
            storage_path: Path within bucket (e.g., "uploads/project_id/upload_id.csv")

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

    @handle_repository_exceptions
    def write_csv_as_parquet(self, csv_content: bytes, storage_path: str) -> str:
        """Convert CSV to Parquet using DuckDB, upload to S3/MinIO.

        Args:
            csv_content: Raw CSV bytes
            storage_path: Path within bucket (e.g., "project_id/dataset_uuid.parquet")

        Returns:
            S3 path (s3://bucket/path)
        """
        conn = ibis.duckdb.connect()

        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        with tempfile.NamedTemporaryFile(mode='wb', suffix='.parquet', delete=False) as temp_parquet:
            temp_parquet_path = temp_parquet.name

        try:
            conn.raw_sql(f"""
                COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                TO '{temp_parquet_path}' (FORMAT PARQUET);
            """)

            with open(temp_parquet_path, 'rb') as parquet_file:
                self.s3_client.put_object(
                    Bucket=self.bucket,
                    Key=storage_path,
                    Body=parquet_file,
                    ContentType='application/octet-stream'
                )

            return f"s3://{self.bucket}/{storage_path}"
        finally:
            if os.path.exists(temp_csv_path):
                os.unlink(temp_csv_path)
            if os.path.exists(temp_parquet_path):
                os.unlink(temp_parquet_path)

    @handle_repository_exceptions
    def write_csv_as_partitioned_parquet(
        self,
        csv_content: bytes,
        storage_prefix: str,
        partition_fields: list[str],
    ) -> str:
        """Convert CSV to partitioned Parquet files using hive-style partitioning.

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
        self._configure_duckdb_s3(conn)

        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        try:
            s3_prefix = f"s3://{self.bucket}/{storage_prefix}"

            if partition_fields:
                # Write partitioned parquet using hive-style partitioning
                partition_by_clause = ", ".join(f"'{f}'" for f in partition_fields)
                conn.raw_sql(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{s3_prefix}' (
                        FORMAT PARQUET,
                        PARTITION_BY ({partition_by_clause}),
                        OVERWRITE_OR_IGNORE true
                    );
                """)
            else:
                # Write single parquet file when no partition fields
                conn.raw_sql(f"""
                    COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                    TO '{s3_prefix}data.parquet' (FORMAT PARQUET);
                """)

            return s3_prefix
        finally:
            if os.path.exists(temp_csv_path):
                os.unlink(temp_csv_path)

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

        return df.to_dict(orient='records')

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
        except Exception:
            pass


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
            self._ensure_bucket_exists(s3_client, settings.storage_bucket)

        super().__init__(s3_client, settings.storage_bucket)
        self._settings = settings

    def _ensure_bucket_exists(self, client, bucket: str) -> None:
        """Create bucket if it doesn't exist."""
        try:
            client.head_bucket(Bucket=bucket)
        except Exception:
            try:
                client.create_bucket(Bucket=bucket)
            except Exception:
                pass

    def _configure_duckdb_s3(self, conn: ibis.BaseBackend) -> None:
        """Configure DuckDB for MinIO access."""
        conn.raw_sql(f"""
            INSTALL httpfs;
            LOAD httpfs;
            SET s3_endpoint='{self._settings.minio_endpoint}';
            SET s3_access_key_id='{self._settings.minio_access_key}';
            SET s3_secret_access_key='{self._settings.minio_secret_key}';
            SET s3_use_ssl={'true' if self._settings.minio_secure else 'false'};
            SET s3_url_style='path';
        """)


class S3LakeRepository(BaseLakeRepository):
    """Lake repository for AWS S3 storage."""

    def __init__(self, s3_client=None):
        """Initialize S3 lake repository.

        Args:
            s3_client: Optional boto3 S3 client. If not provided, creates one from settings.
        """
        settings = get_settings()

        if s3_client is None:
            s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                region_name=settings.s3_region,
                config=Config(
                    retries={'max_attempts': settings.s3_max_retries, 'mode': 'standard'},
                    connect_timeout=settings.s3_connect_timeout,
                    read_timeout=settings.s3_read_timeout,
                ),
            )

        super().__init__(s3_client, settings.storage_bucket)
        self._settings = settings

    def _configure_duckdb_s3(self, conn: ibis.BaseBackend) -> None:
        """Configure DuckDB for AWS S3 access."""
        conn.raw_sql(f"""
            INSTALL httpfs;
            LOAD httpfs;
            SET s3_region='{self._settings.s3_region}';
        """)
