"""Auth routes for login, callback, logout, refresh, and user info."""

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth import get_auth_provider, get_auth_user, enrich_org_id, ensure_org_provisioned, AuthenticationError
from app.auth.rate_limiter import refresh_limiter

router = APIRouter(prefix="/api/auth", tags=["auth"])


class CallbackBody(BaseModel):
    code: str


class RefreshRequest(BaseModel):
    refresh_token: str


@router.get("/login")
async def login(redirect_uri: str | None = None, organization_id: str | None = None):
    """Get login URL to redirect user to."""
    provider = get_auth_provider()
    from app.config import get_settings
    uri = redirect_uri or get_settings().workos_redirect_uri
    url = await provider.get_login_url(uri, organization_id=organization_id)
    return {"url": url}


@router.post("/callback")
async def callback(body: CallbackBody):
    """Exchange auth code for user + tokens."""
    provider = get_auth_provider()
    try:
        user, token, refresh_token, expires_in = await provider.handle_callback(body.code)
    except AuthenticationError as e:
        return JSONResponse({"detail": str(e)}, status_code=401)

    user = await enrich_org_id(user)
    await ensure_org_provisioned(user)

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "org_id": user.org_id,
            "name": user.name,
        },
        "token": token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
    }


@router.post("/refresh")
async def refresh(request: Request, body: RefreshRequest):
    """Exchange a refresh token for new access and refresh tokens."""
    client_ip = request.client.host if request.client else "unknown"
    if not refresh_limiter.check(client_ip):
        return JSONResponse(
            {"detail": "Too many refresh requests"},
            status_code=429,
        )

    provider = get_auth_provider()
    try:
        user, access_token, new_refresh_token, expires_in = await provider.refresh_access_token(body.refresh_token)
    except AuthenticationError:
        return JSONResponse(
            {"detail": "Refresh token invalid or expired"},
            status_code=401,
        )

    return {
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "expires_in": expires_in,
    }


@router.post("/logout")
async def logout():
    """Get logout URL."""
    provider = get_auth_provider()
    url = await provider.get_logout_url()
    return {"url": url}


@router.get("/me")
async def me():
    """Get current authenticated user."""
    try:
        user = get_auth_user()
    except RuntimeError:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    return {
        "id": user.id,
        "email": user.email,
        "org_id": user.org_id,
        "name": user.name,
    }
