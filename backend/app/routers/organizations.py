"""API routes for organization management."""

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers import HTTPController

from .deps import get_current_user, use_db_context

router = APIRouter(prefix="/api/orgs", tags=["organizations"])


class OrgCreate(BaseModel):
    """Schema for creating an organization."""

    name: str

    @field_validator("name")
    @classmethod
    def strip_and_require_non_empty_name(cls, value: str) -> str:
        """Strip surrounding whitespace and require a non-empty name (ADR-050 §c)."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped


@router.post("", status_code=201)
async def post_organization(
    body: OrgCreate,
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Create a new organization for the current user.

    The new org's id is the caller's org claim (``user.org_id`` ← ``X-Org-Id``),
    resolved gated on ``trust_proxy_headers`` in ``get_current_user``: in workos
    mode the auth-proxy sets ``X-Org-Id`` to the WorkOS-minted org id on the
    create-route forward (strip-then-inject, ADR-050 §b) — the WorkOS org id IS
    the local org id. Absent/ungated → backend-generated id (ADR-016: headers
    are never trusted without the gate).
    """
    response_body, status_code = await HTTPController.post_organization(name=body.name, user=user)
    return JSONResponse(content=response_body, status_code=status_code)


@router.get("/availability")
async def get_org_availability(
    name: str = Query(...),
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Report whether an organization name is free to claim (ADR-050 §b).

    Returns a bare ``{"available": bool}`` body — the CDO-S5 auth-proxy
    interception reads ``.available`` directly, so this is intentionally NOT a
    JSON:API envelope. Same identity-header auth as the sibling org routes.
    """
    body, status_code = await HTTPController.check_org_availability(name=name)
    return JSONResponse(content=body, status_code=status_code)


@router.get("/me")
async def get_my_organization(
    user: AuthUser = Depends(get_current_user),
    _: AsyncSession = Depends(use_db_context),
):
    """Get the current user's organization."""
    body, status_code = await HTTPController.get_my_organization(user=user)
    return JSONResponse(content=body, status_code=status_code)
