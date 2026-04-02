"""Lake repository package for Parquet data lake operations.

Provides reading and writing Parquet files to MinIO/S3 storage.
"""

from typing import Any, Protocol


class LakeRepository(Protocol):
    """Protocol for lake repository operations."""

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

    async def read_parquet_preview(self, storage_path: str, limit: int = 10) -> list[dict[str, Any]]:
        """Read preview rows from Parquet file."""
        ...

    async def get_parquet_row_count(self, storage_path: str) -> int:
        """Get row count from Parquet file."""
        ...

    def delete_parquet(self, storage_path: str) -> None:
        """Delete Parquet file from storage."""
        ...

    async def get_parquet_column_type(self, storage_path: str, column: str) -> str:
        """Get the DuckDB type name for a column from Parquet schema."""
        ...

    async def preview_cleaning_operation(
        self,
        storage_path: str,
        target_column: str,
        expression_config: dict[str, Any],
        sample_limit: int = 5,
    ) -> dict[str, Any]:
        """Preview a cleaning operation against Parquet data."""
        ...


from .repository import BaseLakeRepository, MinIOLakeRepository  # noqa: E402

__all__ = ["BaseLakeRepository", "LakeRepository", "MinIOLakeRepository"]
