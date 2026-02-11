"""API routes for transform management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController
from app.database import get_db
from app.repositories import set_session
from .schemas import TransformCreateBatch, TransformBatchUpdate

router = APIRouter(prefix="/api/datasets/{dataset_id}/transforms", tags=["transforms"])


async def use_db_context(db: AsyncSession = Depends(get_db)) -> AsyncSession:
    """Dependency that sets the db session in context for use cases."""
    set_session(db)
    return db


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
