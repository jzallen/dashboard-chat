"""Dataset use cases for file upload and management."""

import io
import re
from typing import Any, TYPE_CHECKING
from uuid import uuid4

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import SQLAlchemyError

from ..exceptions import DatasetNotFound, LakeRepositoryError, MetadataRepositoryError, ProjectIdRequired, ProjectNotFound
from ..repositories import with_db, with_repositories
from ..repositories.dataset_record import DatasetRecord
from ..repositories.transform_record import TransformRecord
from ..models.dataset import Dataset
from ..models.transform import Transform
from ..models import Project
from ..types import QueryBuilderJSON
from ..utils.schema_inference import infer_schema_from_dataframe

if TYPE_CHECKING:
    from ..repositories import RepositoryContainer


@with_repositories
async def list_datasets(project_id: str | None = None, *, repositories: 'RepositoryContainer') -> list[Dataset]:
    """List all datasets for a project.

    Raises:
        ProjectIdRequired: If project_id is not provided.
    """

    if project_id is None:
        raise ProjectIdRequired()
    
    if not await repositories["metadata_repository"].project_exists(project_id=project_id):
        raise ProjectNotFound(project_id)
    
    try:
        result = await repositories["metadata_repository"].list_datasets(project_id=project_id)
    except Exception as e:
        raise MetadataRepositoryError(str(e)) from e

    return [_to_domain_dataset(r, transform_records=r.transforms) for r in result]

@with_repositories
async def get_dataset(
    dataset_id: str,
    include_transforms: bool = True,
    include_preview: bool = False,
    preview_limit: int = 10,
    *,
    repositories: 'RepositoryContainer',
) -> Dataset:
    """Get a single dataset by ID with optional transforms and preview.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
        LakeRepositoryError: If storage operation fails.
    """
    metadata_repo = repositories['metadata_repository']
    lake_repo = repositories['lake_repository']

    try:
        dataset_record = await metadata_repo.get_dataset_record(dataset_id, include_transforms)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    if not dataset_record:
        raise DatasetNotFound(dataset_id)

    preview_rows: list[dict] = []
    if include_preview:
        try:
            preview_rows = lake_repo.read_parquet_preview(dataset_record.storage_path, limit=preview_limit)
        except (BotoCoreError, ClientError) as e:
            raise LakeRepositoryError(str(e)) from e

    transform_records = dataset_record.transforms if include_transforms else []
    return _to_domain_dataset(dataset_record, transform_records=transform_records, preview_rows=preview_rows)


@with_repositories
async def upload_dataset(
    file_content: bytes,
    file_name: str,
    project_id: str,
    name: str,
    description: str | None = None,
    *,
    repositories: 'RepositoryContainer',
) -> dict[str, Any]:
    """Upload a CSV file and create a dataset with Parquet storage.

    Raises:
        ValueError: If project not found, invalid file type, or empty file.
    """
    metadata_repo = repositories['metadata_repository']
    lake_repo = repositories['lake_repository']

    if not await metadata_repo.project_exists(project_id):
        raise ValueError("Project not found")

    if not file_name.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    if not file_content:
        raise ValueError("File is empty")

    dataset_record = await _process_csv_upload(
        metadata_repo=metadata_repo,
        lake_repo=lake_repo,
        project_id=project_id,
        name=name,
        file_content=file_content,
        file_name=file_name,
        description=description,
    )

    preview_rows = lake_repo.read_parquet_preview(dataset_record.storage_path, limit=5)

    return {
        "id": dataset_record.id,
        "storage_path": dataset_record.storage_path,
        "project_id": dataset_record.project_id,
        "name": dataset_record.name,
        "description": dataset_record.description,
        "schema_config": dataset_record.schema_config,
        "row_count": dataset_record.row_count,
        "file_name": dataset_record.file_name,
        "file_size": dataset_record.file_size,
        "created_at": dataset_record.created_at,
        "updated_at": dataset_record.updated_at,
        "preview_rows": preview_rows,
    }


@with_repositories
async def update_dataset(
    dataset_id: str,
    update_dict: dict[str, Any],
    *,
    repositories: 'RepositoryContainer',
) -> Dataset:
    """Update a dataset's metadata and transforms.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        MetadataRepositoryError: If database operation fails.
    """
    dataset = Dataset(id=dataset_id, transforms=update_dict.pop('transforms', None), **update_dict)

    try:
        if not await repositories['metadata_repository'].dataset_exists(dataset_id):
            raise DatasetNotFound(dataset_id)

        await repositories['metadata_repository'].update_dataset(dataset_id, **update_dict)

        if dataset.transforms:
            await repositories['metadata_repository'].update_transforms(dataset.transforms)
    except SQLAlchemyError as e:
        raise MetadataRepositoryError(str(e)) from e

    return await get_dataset(dataset_id, repositories=repositories)






def sanitize_table_name(name: str) -> str:
    """Create a safe table name from dataset name."""
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name.lower())
    if safe_name[0].isdigit():
        safe_name = "t_" + safe_name
    unique_suffix = uuid4().hex[:8]
    return f"data_{safe_name}_{unique_suffix}"


async def _process_csv_upload(
    metadata_repo,
    lake_repo,
    project_id: str,
    name: str,
    file_content: bytes,
    file_name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    """Process a CSV file upload and create dataset with Parquet storage."""
    # Infer schema from CSV for query builder
    df = pd.read_csv(io.BytesIO(file_content))
    schema_config = infer_schema_from_dataframe(df)
    row_count = len(df)

    # Generate UUID for dataset ID
    dataset_id = str(uuid4())

    # Generate parquet storage path (includes UUID)
    storage_path = Dataset.generate_parquet_id(project_id, dataset_id)

    # Write CSV as Parquet to MinIO/S3
    lake_repo.write_csv_as_parquet(file_content, storage_path)

    # Create dataset record
    return await metadata_repo.create_dataset(
        project_id=project_id,
        dataset_id=dataset_id,
        storage_path=storage_path,
        name=name,
        schema_config=schema_config,
        row_count=row_count,
        file_name=file_name,
        file_size=len(file_content),
        description=description,
    )


def _to_domain_dataset(
    dataset_record: DatasetRecord,
    transform_records: list | None = None,
    preview_rows: list[dict] | None = None,
) -> Dataset:
    """Convert ORM DatasetRecord to domain Dataset.

    Args:
        dataset_record: The ORM dataset record
        transform_records: List of transform records (None means don't include transforms)
        preview_rows: Preview data rows
    """
    transforms = []
    if transform_records is not None:
        transforms = [
            Transform(
                id=t.id,
                name=t.name,
                condition_json=QueryBuilderJSON.from_dict(t.condition_json),
                condition_sql=t.condition_sql,
                description=t.description,
                status=t.status,
            )
            for t in transform_records
        ]

    return Dataset(
        id=dataset_record.id,
        project_id=dataset_record.project_id,
        storage_path=dataset_record.storage_path,
        name=dataset_record.name,
        description=dataset_record.description,
        schema_config=dataset_record.schema_config,
        partition_fields=dataset_record.partition_fields or [],
        transforms=transforms,
        preview_rows=preview_rows or [],
    )
