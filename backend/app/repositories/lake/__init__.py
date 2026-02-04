"""Lake repository package for Parquet data lake operations.

Provides reading and writing Parquet files to MinIO/S3 storage.
"""

from typing import Any, Protocol


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


from .repository import BaseLakeRepository, MinIOLakeRepository, S3LakeRepository

__all__ = ["LakeRepository", "BaseLakeRepository", "MinIOLakeRepository", "S3LakeRepository"]
