"""API routes for filter pipeline management."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Dataset, FilterPipeline, PipelineRun
from ..schemas import (
    AggregatedSqlResponse,
    PipelineCreate,
    PipelineResponse,
    PipelineUpdate,
    PipelineExecuteRequest,
    PipelineExecuteResponse,
    PipelineRunResponse,
)
from ..services.pipeline_service import (
    create_pipeline,
    update_pipeline,
    execute_pipeline,
    get_aggregated_sql,
)

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


@router.get("", response_model=list[PipelineResponse])
async def list_pipelines(
    dataset_id: str | None = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """List all pipelines, optionally filtered by dataset."""
    query = select(FilterPipeline)

    if dataset_id:
        query = query.where(FilterPipeline.dataset_id == dataset_id)

    if active_only:
        query = query.where(FilterPipeline.is_active == True)

    query = query.order_by(FilterPipeline.created_at.desc())

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

    sql_where_clause, pipeline_ids = await get_aggregated_sql(db, dataset_id)

    return AggregatedSqlResponse(
        dataset_id=dataset_id,
        enabled_pipeline_count=len(pipeline_ids),
        sql_where_clause=sql_where_clause,
        pipeline_ids=pipeline_ids,
    )


@router.get("/{pipeline_id}", response_model=PipelineResponse)
async def get_pipeline(
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single pipeline by ID."""
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipeline


@router.post("", response_model=PipelineResponse, status_code=201)
async def create_pipeline_route(
    pipeline_data: PipelineCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new filter pipeline.

    The RAQB JSON is stored as-is, and the SQL WHERE clause is
    generated and cached for efficient backend execution.
    """
    # Verify dataset exists
    result = await db.execute(
        select(Dataset).where(Dataset.id == pipeline_data.dataset_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        pipeline = await create_pipeline(
            db=db,
            dataset_id=pipeline_data.dataset_id,
            name=pipeline_data.name,
            raqb_json=pipeline_data.raqb_json,
            description=pipeline_data.description,
            nl_prompt=pipeline_data.nl_prompt,
        )
        return pipeline
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create pipeline: {str(e)}"
        )


@router.patch("/{pipeline_id}", response_model=PipelineResponse)
async def update_pipeline_route(
    pipeline_id: str,
    update_data: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a pipeline.

    If raqb_json is updated, the version is incremented and
    cached_sql is regenerated.
    """
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    try:
        updated = await update_pipeline(
            db=db,
            pipeline=pipeline,
            name=update_data.name,
            description=update_data.description,
            raqb_json=update_data.raqb_json,
            is_active=update_data.is_active,
        )
        return updated
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update pipeline: {str(e)}"
        )


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a pipeline."""
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    await db.delete(pipeline)
    await db.commit()

    return {"status": "deleted", "id": pipeline_id}


@router.post("/{pipeline_id}/deactivate", response_model=PipelineResponse)
async def deactivate_pipeline(
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Deactivate a pipeline (soft delete)."""
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    pipeline.is_active = False
    await db.commit()
    await db.refresh(pipeline)

    return pipeline


@router.post("/{pipeline_id}/execute", response_model=PipelineExecuteResponse)
async def execute_pipeline_route(
    pipeline_id: str,
    request: PipelineExecuteRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Execute a pipeline against its dataset.

    Returns the matching rows along with execution metrics.
    The run is recorded in pipeline_runs for history tracking.
    """
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    pipeline = result.scalar_one_or_none()
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    limit = request.limit if request else 100
    offset = request.offset if request else 0

    try:
        run, rows = await execute_pipeline(
            db=db,
            pipeline=pipeline,
            limit=limit,
            offset=offset,
        )

        return PipelineExecuteResponse(
            pipeline_id=pipeline_id,
            input_row_count=run.input_row_count or 0,
            output_row_count=run.output_row_count or 0,
            execution_time_ms=run.execution_time_ms or 0,
            rows=rows,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Pipeline execution failed: {str(e)}"
        )


@router.get("/{pipeline_id}/runs", response_model=list[PipelineRunResponse])
async def list_pipeline_runs(
    pipeline_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """List recent runs for a pipeline."""
    # Verify pipeline exists
    result = await db.execute(
        select(FilterPipeline).where(FilterPipeline.id == pipeline_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Get runs
    result = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.pipeline_id == pipeline_id)
        .order_by(PipelineRun.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
