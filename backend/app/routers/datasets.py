"""API routes for dataset management."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from returns.result import Success, Failure
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..controllers.dataset_controller import DatasetController
from ..controllers.response_wrapper import wrap_success, wrap_error
from ..database import get_db
from ..db_context import set_session
from ..models import Dataset
from ..schemas import AggregatedSqlResponse, DatasetUpdate
from ..use_cases import transform as transform_use_cases

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


@router.get("")
async def list_datasets(
    project_id: str | None = None,
    _: AsyncSession = Depends(use_db_context),
):
    """List all datasets, optionally filtered by project."""
    result = await DatasetController.list_datasets(project_id)

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
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single dataset by ID with optional transforms and preview."""
    result = await DatasetController.get_dataset(
        dataset_id, include_transforms, include_preview, preview_limit
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
    _: AsyncSession = Depends(use_db_context),
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
        content, file.filename, project_id, name, description
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
    _: AsyncSession = Depends(use_db_context),
):
    """Update a dataset's metadata."""
    result = await DatasetController.update_dataset(dataset_id, update_data)

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
    _: AsyncSession = Depends(use_db_context),
):
    """Delete a dataset and its data table."""
    result = await DatasetController.delete_dataset(dataset_id)

    match result:
        case Success(data):
            return wrap_success(data)
        case Failure(error):
            status_code = 404 if error == "Dataset not found" else 500
            raise HTTPException(
                status_code=status_code,
                detail=wrap_error(error, "DELETE_DATASET_ERROR")
            )


@router.get("/{dataset_id}/aggregated-sql", response_model=AggregatedSqlResponse)
async def get_dataset_aggregated_sql(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get combined SQL WHERE clause from all active transforms for a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    sql_where_clause, transform_ids = await transform_use_cases.get_aggregated_sql(db, dataset_id)

    return AggregatedSqlResponse(
        dataset_id=dataset_id,
        enabled_transform_count=len(transform_ids),
        sql_where_clause=sql_where_clause,
        transform_ids=transform_ids,
    )
