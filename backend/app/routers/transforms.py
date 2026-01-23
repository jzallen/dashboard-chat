"""API routes for transform management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Dataset, Transform
from ..schemas import (
    AggregatedSqlResponse,
    TransformCreate,
    TransformResponse,
    TransformUpdate,
)
from ..services.transform_service import (
    create_transform,
    update_transform,
    get_aggregated_sql,
)

router = APIRouter(prefix="/api/transforms", tags=["transforms"])


@router.get("", response_model=list[TransformResponse])
async def list_transforms(
    dataset_id: str | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """List all transforms, optionally filtered by dataset."""
    query = select(Transform)

    if dataset_id:
        query = query.where(Transform.dataset_id == dataset_id)

    if active_only:
        query = query.where(Transform.is_active == True)

    query = query.order_by(Transform.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/dataset/{dataset_id}/aggregated-sql", response_model=AggregatedSqlResponse)
async def get_aggregated_sql_route(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get combined SQL WHERE clause from all active transforms for a dataset."""
    result = await db.execute(
        select(Dataset).where(Dataset.id == dataset_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    sql_where_clause, transform_ids = await get_aggregated_sql(db, dataset_id)

    return AggregatedSqlResponse(
        dataset_id=dataset_id,
        enabled_transform_count=len(transform_ids),
        sql_where_clause=sql_where_clause,
        transform_ids=transform_ids,
    )


@router.get("/{transform_id}", response_model=TransformResponse)
async def get_transform(
    transform_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single transform by ID."""
    result = await db.execute(
        select(Transform).where(Transform.id == transform_id)
    )
    transform = result.scalar_one_or_none()
    if not transform:
        raise HTTPException(status_code=404, detail="Transform not found")
    return transform


@router.post("", response_model=TransformResponse, status_code=201)
async def create_transform_route(
    transform_data: TransformCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new filter transform.

    The RAQB JSON is stored as-is, and the SQL WHERE clause is
    generated and cached for efficient backend execution.
    """
    # Verify dataset exists
    result = await db.execute(
        select(Dataset).where(Dataset.id == transform_data.dataset_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        transform = await create_transform(
            db=db,
            dataset_id=transform_data.dataset_id,
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


@router.patch("/{transform_id}", response_model=TransformResponse)
async def update_transform_route(
    transform_id: str,
    update_data: TransformUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a transform.

    If raqb_json is updated, the version is incremented and
    cached_sql is regenerated.
    """
    result = await db.execute(
        select(Transform).where(Transform.id == transform_id)
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


@router.delete("/{transform_id}")
async def delete_transform(
    transform_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a transform."""
    result = await db.execute(
        select(Transform).where(Transform.id == transform_id)
    )
    transform = result.scalar_one_or_none()
    if not transform:
        raise HTTPException(status_code=404, detail="Transform not found")

    await db.delete(transform)
    await db.commit()

    return {"status": "deleted", "id": transform_id}
