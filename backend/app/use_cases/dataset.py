"""Dataset use cases for file upload and management."""

import io
import re
from typing import Any
from uuid import uuid4

import pandas as pd
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db_context import with_db
from ..models import Dataset, Project
from ..utils.schema_inference import (
    infer_schema_from_dataframe,
    generate_create_table_sql,
    pandas_dtype_to_sql,
)


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
) -> tuple[Dataset, pd.DataFrame]:
    """Process a CSV file upload and create dataset."""
    df = pd.read_csv(io.BytesIO(file_content))
    schema_config = infer_schema_from_dataframe(df)
    table_name = sanitize_table_name(name)

    create_sql = generate_create_table_sql(table_name, df)
    await db.execute(text(create_sql))

    await _insert_dataframe_to_table(db, table_name, df)

    dataset = Dataset(
        project_id=project_id,
        name=name,
        description=description,
        table_name=table_name,
        schema_config=schema_config,
        row_count=len(df),
        file_name=file_name,
        file_size=len(file_content),
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    return dataset, df


async def _insert_dataframe_to_table(
    db: AsyncSession,
    table_name: str,
    df: pd.DataFrame,
    batch_size: int = 1000,
) -> None:
    """Insert DataFrame rows into a PostgreSQL table."""
    if df.empty:
        return

    columns = [f'"{col}"' for col in df.columns]
    columns_sql = ", ".join(columns)

    for i in range(0, len(df), batch_size):
        batch = df.iloc[i : i + batch_size]

        values_list = []
        for _, row in batch.iterrows():
            values = []
            for val in row:
                if pd.isna(val):
                    values.append("NULL")
                elif isinstance(val, bool):
                    values.append("TRUE" if val else "FALSE")
                elif isinstance(val, (int, float)):
                    values.append(str(val))
                else:
                    escaped = str(val).replace("'", "''")
                    values.append(f"'{escaped}'")
            values_list.append(f"({', '.join(values)})")

        values_sql = ",\n".join(values_list)
        insert_sql = f'INSERT INTO "{table_name}" ({columns_sql}) VALUES {values_sql};'
        await db.execute(text(insert_sql))


async def _get_dataset_preview(
    db: AsyncSession,
    dataset: Dataset,
    limit: int = 10,
) -> list[dict]:
    """Get preview rows from a dataset's table."""
    query = text(f'SELECT * FROM "{dataset.table_name}" LIMIT :limit')
    result = await db.execute(query, {"limit": limit})
    rows = result.fetchall()
    columns = result.keys()
    return [dict(zip(columns, row)) for row in rows]


async def _delete_dataset_table(db: AsyncSession, table_name: str) -> None:
    """Drop the dynamic table for a dataset."""
    await db.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
    await db.commit()


# Public use cases with @with_db decorator

@with_db
async def list_datasets(
    db: AsyncSession,
    project_id: str | None = None,
) -> list[Dataset]:
    """List all datasets, optionally filtered by project."""
    query = select(Dataset)
    if project_id:
        query = query.where(Dataset.project_id == project_id)
    query = query.order_by(Dataset.created_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


@with_db
async def get_dataset(
    db: AsyncSession,
    dataset_id: str,
    include_transforms: bool = True,
    include_preview: bool = False,
    preview_limit: int = 10,
) -> dict[str, Any] | None:
    """Get a single dataset by ID with optional transforms and preview.
    
    Returns None if dataset not found.
    """
    query = select(Dataset).where(Dataset.id == dataset_id)

    if include_transforms:
        query = query.options(selectinload(Dataset.transforms))

    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    if not dataset:
        return None

    dataset_dict = {
        "id": dataset.id,
        "project_id": dataset.project_id,
        "name": dataset.name,
        "description": dataset.description,
        "table_name": dataset.table_name,
        "schema_config": dataset.schema_config,
        "row_count": dataset.row_count,
        "file_name": dataset.file_name,
        "file_size": dataset.file_size,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
        "transforms": dataset.transforms if include_transforms else [],
        "preview_rows": [],
    }

    if include_preview:
        preview_rows = await _get_dataset_preview(db, dataset, limit=preview_limit)
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
    """Upload a CSV file and create a dataset.
    
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

    dataset, df = await _process_csv_upload(
        db=db,
        project_id=project_id,
        name=name,
        file_content=file_content,
        file_name=file_name,
        description=description,
    )

    preview_rows = await _get_dataset_preview(db, dataset, limit=5)

    return {
        "id": dataset.id,
        "project_id": dataset.project_id,
        "name": dataset.name,
        "description": dataset.description,
        "table_name": dataset.table_name,
        "schema_config": dataset.schema_config,
        "row_count": dataset.row_count,
        "file_name": dataset.file_name,
        "file_size": dataset.file_size,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
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
    - Create: transform without id (requires name and raqb_json)
    - Update: transform with id
    - Delete: transform with id and _delete=True
    """
    from .transform import create_transform, update_transform, raqb_to_sql
    from ..models import Transform
    
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.transforms))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if not dataset:
        return None

    # Handle transforms separately
    transforms_input = update_dict.pop("transforms", None)
    
    # Update dataset metadata
    for key, value in update_dict.items():
        setattr(dataset, key, value)

    # Process transform operations
    if transforms_input:
        existing_transforms = {t.id: t for t in dataset.transforms}
        
        for t_input in transforms_input:
            transform_id = t_input.get("id")
            should_delete = t_input.get("_delete", False)
            
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
                    if t_input.get("raqb_json") is not None:
                        transform.raqb_json = t_input["raqb_json"]
                        transform.cached_sql = raqb_to_sql(t_input["raqb_json"])
                        transform.version += 1
                    if t_input.get("is_active") is not None:
                        transform.is_active = t_input["is_active"]
            else:
                # New transform - create
                if t_input.get("name") and t_input.get("raqb_json"):
                    new_transform = Transform(
                        dataset_id=dataset_id,
                        name=t_input["name"],
                        description=t_input.get("description"),
                        raqb_json=t_input["raqb_json"],
                        cached_sql=raqb_to_sql(t_input["raqb_json"]),
                        nl_prompt=t_input.get("nl_prompt"),
                        is_active=t_input.get("is_active", True),
                    )
                    db.add(new_transform)

    await db.commit()
    await db.refresh(dataset)
    
    # Reload transforms after commit
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.transforms))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    
    return {
        "id": dataset.id,
        "project_id": dataset.project_id,
        "name": dataset.name,
        "description": dataset.description,
        "table_name": dataset.table_name,
        "schema_config": dataset.schema_config,
        "row_count": dataset.row_count,
        "file_name": dataset.file_name,
        "file_size": dataset.file_size,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
        "transforms": dataset.transforms,
        "preview_rows": [],
    }


@with_db
async def delete_dataset(
    db: AsyncSession,
    dataset_id: str,
) -> bool:
    """Delete a dataset and its data table.
    
    Returns False if dataset not found.
    """
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        return False

    await _delete_dataset_table(db, dataset.table_name)

    await db.delete(dataset)
    await db.commit()

    return True
