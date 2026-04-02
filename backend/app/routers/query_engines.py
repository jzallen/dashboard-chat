"""API routes for query engine node management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.context import get_auth_user
from app.controllers import HTTPController

from .deps import use_db_context

router = APIRouter(prefix="/api/query-engines", tags=["query-engines"])


@router.get("")
async def list_query_engines(_: AsyncSession = Depends(use_db_context)):
    """List all query engine nodes for the current user's organization."""
    user = get_auth_user()
    body, status_code = await HTTPController.list_query_engines(user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/{node_id}")
async def get_query_engine(node_id: str, _: AsyncSession = Depends(use_db_context)):
    """Get a query engine node with connection strings and project count."""
    user = get_auth_user()
    body, status_code = await HTTPController.get_query_engine(node_id, user=user)
    return JSONResponse(content=body, status_code=status_code)


@router.post("/{node_id}/test")
async def test_query_engine(node_id: str, _: AsyncSession = Depends(use_db_context)):
    """Test connectivity to a query engine node."""
    user = get_auth_user()
    body, status_code = await HTTPController.test_query_engine(node_id, user=user)
    return JSONResponse(content=body, status_code=status_code)
