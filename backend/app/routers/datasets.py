"""API routes for dataset management."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Dataset, Project
from ..schemas import DatasetResponse, DatasetUpdate, DatasetUploadResponse
from ..services.dataset_service import (
    process_csv_upload,
    get_dataset_preview,
    delete_dataset_table,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetResponse])
async def list_datasets(
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List all datasets, optionally filtered by project."""
    query = select(Dataset)
    if project_id:
        query = query.where(Dataset.project_id == project_id)
    query = query.order_by(Dataset.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single dataset by ID."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    name: str = Form(...),
    description: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a CSV file and create a dataset.

    This will:
    1. Parse the CSV file
    2. Infer the schema (RAQB field types and operators)
    3. Create a dynamic table in PostgreSQL
    4. Insert the data
    5. Create the dataset record
    """
    # Verify project exists
    result = await db.execute(select(Project).where(Project.id == project_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate file type
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400, detail="Only CSV files are supported"
        )

    # Read file content
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        dataset, df = await process_csv_upload(
            db=db,
            project_id=project_id,
            name=name,
            file_content=content,
            file_name=file.filename,
            description=description,
        )

        # Get preview rows
        preview_rows = await get_dataset_preview(db, dataset, limit=5)

        return DatasetUploadResponse(
            **{
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
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process file: {str(e)}"
        )


@router.patch("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: str,
    update_data: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a dataset's metadata."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Update fields
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(dataset, key, value)

    await db.commit()
    await db.refresh(dataset)
    return dataset


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a dataset and its data table."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Drop the dynamic table
    await delete_dataset_table(db, dataset.table_name)

    # Delete the dataset record
    await db.delete(dataset)
    await db.commit()

    return {"status": "deleted", "id": dataset_id}


@router.get("/{dataset_id}/preview")
async def preview_dataset(
    dataset_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """Get preview rows from a dataset's table."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = await get_dataset_preview(db, dataset, limit=min(limit, 100))
    return {
        "dataset_id": dataset_id,
        "row_count": dataset.row_count,
        "rows": rows,
    }


@router.get("/{dataset_id}/schema")
async def get_dataset_schema(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get the RAQB schema configuration for a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return {
        "dataset_id": dataset_id,
        "schema_config": dataset.schema_config,
    }
