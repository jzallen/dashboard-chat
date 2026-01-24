"""API routes for dataset management."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from returns.result import Success, Failure
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..controllers.dataset_controller import DatasetController
from ..controllers.response_wrapper import wrap_success, wrap_error
from ..database import get_db
from ..models import Dataset, Transform
from ..schemas import (
    AggregatedSqlResponse,
    DatasetUpdate,
    TransformCreate,
    TransformResponse,
    TransformUpdate,
)
from ..services.transform_service import (
    create_transform,
    update_transform,
    get_aggregated_sql,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("")
async def list_datasets(
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List all datasets, optionally filtered by project."""
    result = await DatasetController.list_datasets(db, project_id)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            raise HTTPException(
                status_code=500,
                detail=wrap_error(error, "LIST_DATASETS_ERROR")
            )


@router.get("/{dataset_id}")
async def get_dataset(
    dataset_id: str,
    include_transforms: bool = Query(default=True, description="Include transforms"),
    include_preview: bool = Query(default=False, description="Include preview rows"),
    preview_limit: int = Query(default=10, ge=1, le=100, description="Preview row limit"),
    db: AsyncSession = Depends(get_db),
):
    """Get a single dataset by ID with optional transforms and preview."""
    result = await DatasetController.get_dataset(
        db, dataset_id, include_transforms, include_preview, preview_limit
    )

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Dataset not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "GET_DATASET_ERROR")
            )


@router.post("/upload")
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
    # Validate filename exists
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail=wrap_error("Filename is required", "INVALID_FILE")
        )

    # Read file content
    content = await file.read()

    result = await DatasetController.upload_dataset(
        db, content, file.filename, project_id, name, description
    )

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            # Determine appropriate status code
            if error == "Project not found":
                status_code = 404
            elif error in ["Only CSV files are supported", "File is empty"]:
                status_code = 400
            else:
                status_code = 500

            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "UPLOAD_DATASET_ERROR")
            )


@router.patch("/{dataset_id}")
async def update_dataset(
    dataset_id: str,
    update_data: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a dataset's metadata."""
    result = await DatasetController.update_dataset(db, dataset_id, update_data)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Dataset not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "UPDATE_DATASET_ERROR")
            )


@router.delete("/{dataset_id}")
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a dataset and its data table."""
    result = await DatasetController.delete_dataset(db, dataset_id)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Dataset not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "DELETE_DATASET_ERROR")
            )


# Transform management routes

@router.get("/{dataset_id}/transforms", response_model=list[TransformResponse])
async def list_dataset_transforms(
    dataset_id: str,
    active_only: bool = Query(default=True, description="Only return active transforms"),
    db: AsyncSession = Depends(get_db),
):
    """List all transforms for a dataset."""
    # Verify dataset exists
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    query = select(Transform).where(Transform.dataset_id == dataset_id)

    if active_only:
        query = query.where(Transform.is_active == True)

    query = query.order_by(Transform.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/{dataset_id}/transforms", response_model=TransformResponse, status_code=201)
async def create_dataset_transform(
    dataset_id: str,
    transform_data: TransformCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new transform for a dataset.

    The RAQB JSON is stored as-is, and the SQL WHERE clause is
    generated and cached for efficient backend execution.
    """
    # Verify dataset exists
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        transform = await create_transform(
            db=db,
            dataset_id=dataset_id,
            name=transform_data.name,
            raqb_json=transform_data.raqb_json,
            description=transform_data.description,
            nl_prompt=transform_data.nl_prompt,
        )
        return transform
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create transform: {str(e)}"
        )


@router.get("/{dataset_id}/transforms/{transform_id}", response_model=TransformResponse)
async def get_dataset_transform(
    dataset_id: str,
    transform_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single transform by ID."""
    result = await db.execute(
        select(Transform).where(
            Transform.id == transform_id,
            Transform.dataset_id == dataset_id,
        )
    )
    transform = result.scalar_one_or_none()
    if not transform:
        raise HTTPException(status_code=404, detail="Transform not found")
    return transform


@router.patch("/{dataset_id}/transforms/{transform_id}", response_model=TransformResponse)
async def update_dataset_transform(
    dataset_id: str,
    transform_id: str,
    update_data: TransformUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a transform.

    If raqb_json is updated, the version is incremented and
    cached_sql is regenerated.
    """
    result = await db.execute(
        select(Transform).where(
            Transform.id == transform_id,
            Transform.dataset_id == dataset_id,
        )
    )
    transform = result.scalar_one_or_none()
    if not transform:
        raise HTTPException(status_code=404, detail="Transform not found")

    try:
        updated = await update_transform(
            db=db,
            transform=transform,
            name=update_data.name,
            description=update_data.description,
            raqb_json=update_data.raqb_json,
            is_active=update_data.is_active,
        )
        return updated
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update transform: {str(e)}"
        )


@router.delete("/{dataset_id}/transforms/{transform_id}")
async def delete_dataset_transform(
    dataset_id: str,
    transform_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a transform."""
    result = await db.execute(
        select(Transform).where(
            Transform.id == transform_id,
            Transform.dataset_id == dataset_id,
        )
    )
    transform = result.scalar_one_or_none()
    if not transform:
        raise HTTPException(status_code=404, detail="Transform not found")

    await db.delete(transform)
    await db.commit()

    return {"status": "deleted", "id": transform_id}


@router.get("/{dataset_id}/aggregated-sql", response_model=AggregatedSqlResponse)
async def get_dataset_aggregated_sql(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get combined SQL WHERE clause from all active transforms for a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    sql_where_clause, transform_ids = await get_aggregated_sql(db, dataset_id)

    return AggregatedSqlResponse(
        dataset_id=dataset_id,
        enabled_transform_count=len(transform_ids),
        sql_where_clause=sql_where_clause,
        transform_ids=transform_ids,
    )
