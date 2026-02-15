"""API routes for transform management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from .deps import use_db_context
from .schemas import TransformCreateBatch, TransformBatchUpdate, PreviewRequest

router = APIRouter(prefix="/api/datasets/{dataset_id}/transforms", tags=["transforms"])


@router.post("")
async def create_transforms(
    dataset_id: str,
    data: TransformCreateBatch,
    _: AsyncSession = Depends(use_db_context),
):
    """Batch-create transforms on a dataset."""
    transforms = [t.model_dump() for t in data.transforms]
    body, status_code = await HTTPController.post_transforms(dataset_id, transforms)
    return JSONResponse(content=body, status_code=status_code)


@router.patch("")
async def update_transforms(
    dataset_id: str,
    data: TransformBatchUpdate,
    _: AsyncSession = Depends(use_db_context),
):
    """Batch-update transforms (including soft-delete via status='deleted')."""
    updates = [u.model_dump(exclude_unset=True) for u in data.updates]
    body, status_code = await HTTPController.patch_transforms(dataset_id, updates)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/preview")
async def preview_transform(
    dataset_id: str,
    data: PreviewRequest,
    _: AsyncSession = Depends(use_db_context),
):
    """Preview a cleaning transform without persisting anything."""
    body, status_code = await HTTPController.preview_transform(
        dataset_id, data.target_column, data.expression_config
    )
    return JSONResponse(content=body, status_code=status_code)
