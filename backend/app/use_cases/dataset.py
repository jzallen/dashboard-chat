"""Dataset use cases for file upload and management."""

import io
import re
from typing import Any
from uuid import uuid4

import pandas as pd
from sqlalchemy import select, exists
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db_context import with_db
from ..repositories.dataset_record import DatasetRecord
from ..repositories.transform_record import TransformRecord
from ..repositories.lake_repository import lake_repository
from ..models.dataset import Dataset as DomainDataset
from ..models.transform import Transform as DomainTransform
from ..models import Project
from ..types import QueryBuilderJSON
from ..utils.schema_inference import infer_schema_from_dataframe


def sanitize_table_name(name: str) -> str:
    """Create a safe table name from dataset name."""
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name.lower())
    if safe_name[0].isdigit():
        safe_name = "t_" + safe_name
    unique_suffix = uuid4().hex[:8]
    return f"data_{safe_name}_{unique_suffix}"


# Internal helpers that receive db explicitly

async def _process_csv_upload(
    db: AsyncSession,
    project_id: str,
    name: str,
    file_content: bytes,
    file_name: str | None = None,
    description: str | None = None,
) -> tuple[DatasetRecord, bytes]:
    """Process a CSV file upload and create dataset with Parquet storage."""
    # Infer schema from CSV for query builder
    df = pd.read_csv(io.BytesIO(file_content))
    schema_config = infer_schema_from_dataframe(df)
    row_count = len(df)

    # Generate UUID for dataset ID
    dataset_id = str(uuid4())

    # Generate parquet storage path (includes UUID)
    storage_path = DomainDataset.generate_parquet_id(project_id, dataset_id)

    # Write CSV as Parquet to MinIO/S3
    s3_path = lake_repository.write_csv_as_parquet(file_content, storage_path)

    # Create dataset record with UUID ID and separate storage_path
    dataset_record = DatasetRecord(
        id=dataset_id,
        storage_path=storage_path,
        project_id=project_id,
        name=name,
        description=description,
        schema_config=schema_config,
        row_count=row_count,
        file_name=file_name,
        file_size=len(file_content),
    )

    db.add(dataset_record)
    await db.commit()
    await db.refresh(dataset_record)

    return dataset_record, file_content

async def _get_dataset_preview(
    db: AsyncSession,
    dataset_record: DatasetRecord,
    limit: int = 10,
) -> list[dict]:
    """Get preview rows from a dataset's Parquet file."""
    return lake_repository.read_parquet_preview(dataset_record.storage_path, limit)


async def _delete_dataset_table(db: AsyncSession, storage_path: str) -> None:
    """Delete the Parquet file for a dataset."""
    lake_repository.delete_parquet(storage_path)


def _to_domain_dataset(dataset_record: DatasetRecord) -> DomainDataset:
    """Convert ORM DatasetRecord to domain Dataset."""
    transforms = [
        DomainTransform(
            id=t.id,
            name=t.name,
            condition_json=QueryBuilderJSON.from_dict(t.condition_json),
            condition_sql=t.condition_sql,
            description=t.description,
            is_active=t.is_active,
        )
        for t in dataset_record.transforms
    ]

    return DomainDataset(
        id=dataset_record.id,
        storage_path=dataset_record.storage_path,
        name=dataset_record.name,
        schema_config=dataset_record.schema_config,
        transforms=transforms,
    )


# Public use cases with @with_db decorator

@with_db
async def list_datasets(
    db: AsyncSession,
    project_id: str | None = None,
) -> list[DomainDataset]:
    """List all datasets for a project.

    Raises:
        ProjectIdRequired: If project_id is not provided.
    """
    from ..exceptions import ProjectIdRequired, ProjectNotFound

    if project_id is None:
        raise ProjectIdRequired()
    
    is_existing = (await db.execute(
        select(exists().where(Project.id == project_id))
    )).scalar()
    if not is_existing:
        raise ProjectNotFound(project_id)

    query = (
        select(DatasetRecord)
        .options(selectinload(DatasetRecord.transforms))
        .where(DatasetRecord.project_id == project_id)
        .order_by(DatasetRecord.created_at.desc())
    )

    result = await db.execute(query)
    return [_to_domain_dataset(r) for r in result.scalars()]


@with_db
async def get_dataset(
    db: AsyncSession,
    dataset_id: str,
    include_transforms: bool = True,
    include_preview: bool = False,
    preview_limit: int = 10,
) -> dict[str, Any] | None:
    """Get a single dataset by ID with optional transforms, preview, and staging_sql.

    Returns None if dataset not found.
    """
    query = select(DatasetRecord).where(DatasetRecord.id == dataset_id)

    if include_transforms:
        query = query.options(selectinload(DatasetRecord.transforms))

    result = await db.execute(query)
    dataset_record = result.scalar_one_or_none()
    if not dataset_record:
        return None

    dataset_dict = {
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
        "transforms": dataset_record.transforms if include_transforms else [],
        "preview_rows": [],
    }

    # Add staging_sql if transforms are included (shows base query even without transforms)
    # Uses display_sql for human-readable output with dataset name instead of S3 path
    if include_transforms:
        try:
            domain_dataset = _to_domain_dataset(dataset_record)
            dataset_dict["staging_sql"] = domain_dataset.display_sql
        except Exception as e:
            dataset_dict["staging_sql"] = f"-- Error generating SQL: {str(e)}"

    if include_preview:
        preview_rows = await _get_dataset_preview(db, dataset_record, limit=preview_limit)
        dataset_dict["preview_rows"] = preview_rows

    return dataset_dict


@with_db
async def upload_dataset(
    db: AsyncSession,
    file_content: bytes,
    file_name: str,
    project_id: str,
    name: str,
    description: str | None = None,
) -> dict[str, Any]:
    """Upload a CSV file and create a dataset with Parquet storage.

    Raises:
        ValueError: If project not found, invalid file type, or empty file.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    if not result.scalar_one_or_none():
        raise ValueError("Project not found")

    if not file_name.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported")

    if not file_content:
        raise ValueError("File is empty")

    dataset_record, csv_content = await _process_csv_upload(
        db=db,
        project_id=project_id,
        name=name,
        file_content=file_content,
        file_name=file_name,
        description=description,
    )

    preview_rows = await _get_dataset_preview(db, dataset_record, limit=5)

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


@with_db
async def update_dataset(
    db: AsyncSession,
    dataset_id: str,
    update_dict: dict[str, Any],
) -> dict[str, Any] | None:
    """Update a dataset's metadata and transforms.

    Returns None if dataset not found.

    Transform operations via the 'transforms' field:
    - Create: transform without id (requires name, condition_json, and condition_sql)
    - Update: transform with id
    - Delete: transform with id and delete=True
    """
    result = await db.execute(
        select(DatasetRecord)
        .options(selectinload(DatasetRecord.transforms))
        .where(DatasetRecord.id == dataset_id)
    )
    dataset_record = result.scalar_one_or_none()
    if not dataset_record:
        return None

    # Handle transforms separately
    transforms_input = update_dict.pop("transforms", None)

    # Update dataset metadata
    for key, value in update_dict.items():
        setattr(dataset_record, key, value)

    # Process transform operations
    # Frontend provides both condition_json (for UI) and condition_sql (for backend)
    if transforms_input:
        existing_transforms = {t.id: t for t in dataset_record.transforms}

        for t_input in transforms_input:
            transform_id = t_input.get("id")
            should_delete = t_input.get("delete", False)

            if transform_id:
                # Existing transform - update or delete
                transform = existing_transforms.get(transform_id)
                if not transform:
                    continue  # Skip if transform doesn't belong to this dataset

                if should_delete:
                    await db.delete(transform)
                else:
                    # Update existing transform
                    if t_input.get("name") is not None:
                        transform.name = t_input["name"]
                    if t_input.get("description") is not None:
                        transform.description = t_input["description"]
                    # condition_json and condition_sql come from frontend RAQB
                    if t_input.get("condition_json") is not None:
                        transform.condition_json = t_input["condition_json"]
                        transform.condition_sql = t_input.get("condition_sql")
                        transform.version += 1
                    if t_input.get("is_active") is not None:
                        transform.is_active = t_input["is_active"]
            else:
                # New transform - create (requires name, condition_json, and condition_sql)
                if t_input.get("name") and t_input.get("condition_json"):
                    new_transform = TransformRecord(
                        dataset_id=dataset_id,
                        name=t_input["name"],
                        description=t_input.get("description"),
                        condition_json=t_input["condition_json"],
                        condition_sql=t_input.get("condition_sql"),
                        nl_prompt=t_input.get("nl_prompt"),
                        is_active=t_input.get("is_active", True),
                    )
                    db.add(new_transform)

    await db.commit()
    await db.refresh(dataset_record)

    # Reload transforms after commit
    result = await db.execute(
        select(DatasetRecord)
        .options(selectinload(DatasetRecord.transforms))
        .where(DatasetRecord.id == dataset_id)
    )
    dataset_record = result.scalar_one_or_none()

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
        "transforms": dataset_record.transforms,
        "preview_rows": [],
    }


@with_db
async def delete_dataset(
    db: AsyncSession,
    dataset_id: str,
) -> bool:
    """Delete a dataset and its Parquet file.

    Returns False if dataset not found.
    """
    result = await db.execute(select(DatasetRecord).where(DatasetRecord.id == dataset_id))
    dataset_record = result.scalar_one_or_none()
    if not dataset_record:
        return False

    await _delete_dataset_table(db, dataset_record.storage_path)

    await db.delete(dataset_record)
    await db.commit()

    return True
