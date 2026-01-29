"""Lake repository for Parquet data lake operations.

This repository handles reading and writing Parquet files to MinIO/S3 storage.
"""

import boto3
from botocore.client import Config
import ibis
import tempfile
import os
from typing import Any

from ..config import get_settings


class LakeRepository:
    """Repository for Parquet data lake operations.

    Writes: boto3 to MinIO/S3
    Reads: Ibis + DuckDB
    """

    def __init__(self):
        """Initialize LakeRepository with S3/MinIO client."""
        settings = get_settings()

        # Configure S3 client for MinIO or AWS S3
        if settings.storage_type == "minio":
            self.s3_client = boto3.client(
                's3',
                endpoint_url=f"http://{settings.minio_endpoint}",
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                config=Config(signature_version='s3v4'),
            )
        else:
            # AWS S3
            self.s3_client = boto3.client(
                's3',
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                region_name=settings.s3_region,
            )

        self.settings = settings
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        """Create bucket if it doesn't exist."""
        try:
            self.s3_client.head_bucket(Bucket=self.settings.storage_bucket)
        except Exception:
            try:
                self.s3_client.create_bucket(Bucket=self.settings.storage_bucket)
            except Exception:
                # Bucket might exist or we don't have permission to create it
                pass

    def write_csv_as_parquet(self, csv_content: bytes, storage_path: str) -> str:
        """Convert CSV to Parquet using DuckDB, upload to S3/MinIO.

        Args:
            csv_content: Raw CSV bytes
            storage_path: Path within bucket (e.g., "project_id/dataset_uuid.parquet")

        Returns:
            S3 path (s3://bucket/path)
        """
        # Use DuckDB for CSV → Parquet conversion (no pandas)
        conn = ibis.duckdb.connect()

        # Write CSV to temp file
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.csv', delete=False) as temp_csv:
            temp_csv.write(csv_content)
            temp_csv_path = temp_csv.name

        # Create temp Parquet file
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.parquet', delete=False) as temp_parquet:
            temp_parquet_path = temp_parquet.name

        try:
            # Convert to Parquet using DuckDB
            conn.raw_sql(f"""
                COPY (SELECT * FROM read_csv_auto('{temp_csv_path}'))
                TO '{temp_parquet_path}' (FORMAT PARQUET);
            """)

            # Upload to S3/MinIO
            with open(temp_parquet_path, 'rb') as parquet_file:
                self.s3_client.put_object(
                    Bucket=self.settings.storage_bucket,
                    Key=storage_path,
                    Body=parquet_file,
                    ContentType='application/octet-stream'
                )

            return f"s3://{self.settings.storage_bucket}/{storage_path}"
        finally:
            # Cleanup temp files
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
        self._configure_s3(conn)

        s3_path = f"s3://{self.settings.storage_bucket}/{storage_path}"
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
        self._configure_s3(conn)

        s3_path = f"s3://{self.settings.storage_bucket}/{storage_path}"
        table = conn.read_parquet(s3_path)
        count = table.count().execute()

        return int(count)

    def delete_parquet(self, storage_path: str):
        """Delete Parquet file from storage.

        Args:
            storage_path: Path within bucket
        """
        try:
            self.s3_client.delete_object(
                Bucket=self.settings.storage_bucket,
                Key=storage_path
            )
        except Exception:
            # File might not exist, that's OK
            pass

    def _configure_s3(self, conn: ibis.BaseBackend):
        """Configure DuckDB for S3/MinIO access.

        Args:
            conn: Ibis DuckDB connection
        """
        if self.settings.storage_type == "minio":
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_endpoint='{self.settings.minio_endpoint}';
                SET s3_access_key_id='{self.settings.minio_access_key}';
                SET s3_secret_access_key='{self.settings.minio_secret_key}';
                SET s3_use_ssl={'true' if self.settings.minio_secure else 'false'};
                SET s3_url_style='path';
            """)
        else:
            # AWS S3 configuration
            conn.raw_sql(f"""
                INSTALL httpfs;
                LOAD httpfs;
                SET s3_region='{self.settings.s3_region}';
            """)


# Singleton instance
lake_repository = LakeRepository()
