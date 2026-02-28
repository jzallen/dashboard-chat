"""Ingestion pipeline helpers for creating datasets from uploads."""

import asyncio
import json

import pandas as pd

from app.models.dataset import Dataset
from app.repositories.outbox import OutboxRepository
from app.use_cases.upload.exceptions import UploadNotFound
from app.utils.column_profiler import compute_column_profiles
from app.utils.schema_inference import infer_schema_from_dataframe


async def fetch_upload_event(outbox_repo: OutboxRepository, upload_id: str):
    """Fetch and validate the upload outbox event."""
    event = await outbox_repo.get_file_received_event_by_id(upload_id)
    if event is None:
        raise UploadNotFound(upload_id)
    return event


async def read_raw_file(lake_repo, storage_path: str, upload_id: str) -> bytes:
    """Read the raw uploaded file from storage."""
    raw_content = await asyncio.to_thread(lake_repo.read_raw_file, storage_path)
    if not raw_content:
        raise UploadNotFound(upload_id)
    return raw_content


def analyze_dataframe(df: pd.DataFrame) -> tuple[dict, list[dict], list[dict]]:
    """Infer schema, compute column profiles, and generate preview rows."""
    schema_config = infer_schema_from_dataframe(df)
    column_profiles = compute_column_profiles(df, schema_config)
    preview_rows = json.loads(df.head(10).to_json(orient="records", date_format="iso"))
    return schema_config, column_profiles, preview_rows


async def create_dataset_record(
    metadata_repo,
    project_id: str,
    schema_config: dict,
    description: str | None,
    partition_fields: list[str],
    column_profiles: list[dict],
    preview_rows: list[dict],
) -> Dataset:
    """Create the dataset metadata record and return a Dataset domain object."""
    dataset_dict = await metadata_repo.create_dataset(
        project_id=project_id,
        name="New Dataset",
        schema_config=schema_config,
        description=description,
        partition_fields=partition_fields,
        column_profiles=column_profiles,
    )
    return Dataset(
        id=dataset_dict["id"],
        project_id=dataset_dict["project_id"],
        name=dataset_dict["name"],
        description=dataset_dict["description"],
        schema_config=dataset_dict["schema_config"],
        partition_fields=dataset_dict["partition_fields"],
        preview_rows=preview_rows,
        column_profiles=dataset_dict["column_profiles"],
    )


async def write_parquet(lake_repo, df: pd.DataFrame, dataset: Dataset, partition_fields: list[str]) -> None:
    """Write the cleaned CSV as partitioned parquet files to storage."""
    cleaned_csv = df.to_csv(index=False).encode("utf-8")
    await asyncio.to_thread(
        lambda: lake_repo.write_csv_as_partitioned_parquet(
            csv_content=cleaned_csv,
            storage_prefix=dataset.storage_path,
            partition_fields=partition_fields,
        )
    )
