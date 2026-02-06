"""API routes for dataset management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.database import get_db
from app.repositories import set_session
from .schemas import DatasetCreate, DatasetUpdate

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
    body, status_code = await HTTPController.list_datasets(project_id)
    return JSONResponse(content=body, status_code=status_code)


@router.post("")
async def create_dataset(
    data: DatasetCreate,
    _: AsyncSession = Depends(use_db_context),
):
    """Create a dataset from an upload event with partition configuration.

    Step 2 of the upload flow:
    1. Validates upload exists and is pending
    2. Reads raw file from uploads/{project_id}/{upload_id}.csv
    3. Writes partitioned parquet to datasets/{project_id}/{dataset_id}/
    4. Creates dataset record with partition_fields
    5. Updates upload event with dataset_id and status=completed
    """
    body, status_code = await HTTPController.post_dataset(
        upload_id=data.upload_id,
        name=data.name,
        partition_fields=data.partition_fields,
        description=data.description,
    )
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{dataset_id}")
async def get_dataset(
    dataset_id: str,
    include_transforms: bool = Query(default=True, description="Include transforms"),
    include_preview: bool = Query(default=False, description="Include preview rows"),
    preview_limit: int = Query(default=10, ge=1, le=100, description="Preview row limit"),
    _: AsyncSession = Depends(use_db_context),
):
    """Get a single dataset by ID with optional transforms and preview."""
    body, status_code = await HTTPController.get_dataset(
        dataset_id, include_transforms, include_preview, preview_limit
    )
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{dataset_id}")
async def update_dataset(
    dataset_id: str,
    update_data: DatasetUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Update a dataset's metadata."""
    dataset_kwargs = update_data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_dataset(dataset_id, **dataset_kwargs)
    return JSONResponse(content=body, status_code=status_code)


# Note: Transforms are created via PATCH /{dataset_id} with transforms array
# Note: /aggregated-sql endpoint removed - use GET /{dataset_id} with include_transforms=true
# to get staging_sql property instead
