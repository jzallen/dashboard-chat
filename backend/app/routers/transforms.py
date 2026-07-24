"""API routes for transform management."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers.dataset_controller import DatasetController
from app.infra.idempotency import idempotent_request

from .deps import get_current_user, use_db_context
from .schemas import PreviewRequest, TransformBatchUpdate, TransformCreateBatch

router = APIRouter(prefix="/api/datasets/{dataset_id}/transforms", tags=["transforms"])


@router.post("")
async def create_transforms(
    request: Request,
    dataset_id: str,
    data: TransformCreateBatch,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Batch-create transforms on a dataset.

    Honors the optional `Idempotency-Key` request header (Epic C.3): a retry
    with the same key returns the cached response without re-creating the
    transforms. Reuse with a mismatched body returns 409.
    """
    transforms = [t.model_dump() for t in data.transforms]

    async def handler() -> tuple[dict, int]:
        return await DatasetController.post_transforms(dataset_id, transforms)

    return await idempotent_request(
        request=request,
        db=db,
        user=user,
        endpoint_id="POST /api/datasets/{dataset_id}/transforms",
        handler=handler,
    )


@router.patch("")
async def update_transforms(
    request: Request,
    dataset_id: str,
    data: TransformBatchUpdate,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
):
    """Batch-update transforms (including soft-delete via status='deleted').

    Honors `Idempotency-Key` (Epic C.3); this is the soft-delete entry point
    that stands in for `DELETE /rows/{id}` in the bead's mutation set.
    """
    updates = [u.model_dump(exclude_unset=True) for u in data.updates]

    async def handler() -> tuple[dict, int]:
        return await DatasetController.patch_transforms(dataset_id, updates)

    return await idempotent_request(
        request=request,
        db=db,
        user=user,
        endpoint_id="PATCH /api/datasets/{dataset_id}/transforms",
        handler=handler,
    )


@router.post("/preview")
async def preview_transform(
    dataset_id: str,
    data: PreviewRequest,
    _: AsyncSession = Depends(use_db_context),
):
    """Preview a cleaning transform without persisting anything."""
    body, status_code = await DatasetController.preview_transform(
        dataset_id, data.target_column, data.expression_config
    )
    return JSONResponse(content=body, status_code=status_code)
