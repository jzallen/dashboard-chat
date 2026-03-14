"""API routes for dataset management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import authorize_dataset_access, get_current_user, use_db_context
from .schemas import DatasetCreate, DatasetUpdate

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("")
async def list_datasets(
    project_id: str | None = None,
    page_after: str | None = Query(default=None, alias="page[after]"),
    page_size: int = Query(default=50, ge=1, le=100, alias="page[size]"),
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """List all datasets with cursor-based pagination, optionally filtered by project."""
    body, status_code = await HTTPController.list_datasets(
        project_id, cursor=page_after, page_size=page_size
    )
    return JSONResponse(content=body, status_code=status_code)


@router.post("")
async def create_dataset(
    data: DatasetCreate,
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Create a dataset from an upload event with partition configuration."""
    body, status_code = await HTTPController.post_dataset(
        upload_id=data.upload_id,
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
    auth: tuple[AuthUser, dict] = Depends(authorize_dataset_access),
):
    """Get a single dataset by ID with optional transforms and preview."""
    _user, _ = auth
    body, status_code = await HTTPController.get_dataset(dataset_id, include_transforms, include_preview, preview_limit)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("/{dataset_id}")
async def update_dataset(
    update_data: DatasetUpdate,
    auth: tuple[AuthUser, dict] = Depends(authorize_dataset_access),
):
    """Update a dataset's metadata."""
    _user, dataset = auth
    dataset_kwargs = update_data.model_dump(exclude_unset=True)
    body, status_code = await HTTPController.patch_dataset(dataset["id"], **dataset_kwargs)
    return JSONResponse(content=body, status_code=status_code)


# Note: Transforms are managed via /api/datasets/{dataset_id}/transforms endpoints
