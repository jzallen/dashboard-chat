"""Lake repository for Parquet data lake operations.

This repository handles reading and writing Parquet files to MinIO/S3 storage.
"""

import os
import tempfile
from abc import ABC, abstractmethod
from typing import Any, Protocol

import boto3
import ibis
from botocore.client import Config

from ..config import get_settings


class LakeRepository(Protocol):
    """Protocol for lake repository operations."""

    def write_csv_as_parquet(self, csv_content: bytes, storage_path: str) -> str:
        """Convert CSV to Parquet and upload to storage."""
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

    def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict[str, Any]]:
        """Read preview rows from Parquet via DuckDB.

        Args:
            storage_path: Path within bucket
            limit: Number of rows to return

        Returns:
            List of row dictionaries
        """
        conn = ibis.duckdb.connect()
        self._configure_duckdb_s3(conn)

        s3_path = f"s3://{self.bucket}/{storage_path}"
        table = conn.read_parquet(s3_path)
        df = table.limit(limit).execute()

        return df.to_dict(orient='records')

    def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file.

        Args:
            storage_path: Path within bucket

        Returns:
            Number of rows in the Parquet file
        """
        conn = ibis.duckdb.connect()
        self._configure_duckdb_s3(conn)

        s3_path = f"s3://{self.bucket}/{storage_path}"
        table = conn.read_parquet(s3_path)
        count = table.count().execute()

        return int(count)

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
                config=Config(signature_version='s3v4'),
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
