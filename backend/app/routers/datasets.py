"""API routes for dataset management."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from returns.result import Success, Failure
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..controllers.dataset_controller import DatasetController
from ..controllers.response_wrapper import wrap_success, wrap_error
from ..database import get_db
from ..repositories import set_session
from ..repositories.dataset_record import DatasetRecord
from ..schemas import DatasetUpdate

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
    """Upload a CSV file and create a dataset with Parquet storage.

    This will:
    1. Parse the CSV file
    2. Infer the schema (RAQB field types and operators)
    3. Convert CSV to Parquet using DuckDB
    4. Upload Parquet file to MinIO/S3
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
    dataset_kwargs = update_data.model_dump(exclude_unset=True)
    result = await DatasetController.update_dataset(dataset_id, **dataset_kwargs)

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
    """Delete a dataset and its Parquet file."""
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


# Note: Transforms are created via PATCH /{dataset_id} with transforms array
# Note: /aggregated-sql endpoint removed - use GET /{dataset_id} with include_transforms=true
# to get staging_sql property instead
