"""API routes for organization management."""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import HTTPController

from .deps import use_db_context

router = APIRouter(prefix="/api/orgs", tags=["organizations"])


class OrgCreate(BaseModel):
    """Schema for creating an organization."""

    name: str


@router.post("", status_code=201)
async def post_organization(
    body: OrgCreate,
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new organization for the current user."""
    response_body, status_code = await HTTPController.post_organization(name=body.name)
    return JSONResponse(content=response_body, status_code=status_code)


@router.get("/me")
async def get_my_organization(
    _: AsyncSession = Depends(use_db_context),
):
    """Get the current user's organization."""
    body, status_code = await HTTPController.get_my_organization()
    return JSONResponse(content=body, status_code=status_code)
