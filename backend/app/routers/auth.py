"""Auth routes for login, callback, logout, and user info."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.auth import get_auth_provider, get_auth_user, AuthenticationError

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/login")
async def login(redirect_uri: str | None = None):
    """Get login URL to redirect user to."""
    provider = get_auth_provider()
    from app.config import get_settings
    uri = redirect_uri or get_settings().workos_redirect_uri
    url = await provider.get_login_url(uri)
    return {"url": url}


@router.post("/callback")
async def callback(body: dict):
    """Exchange auth code for user + token."""
    code = body.get("code", "")
    provider = get_auth_provider()
    try:
        user, token = await provider.handle_callback(code)
    except AuthenticationError as e:
        return JSONResponse({"detail": str(e)}, status_code=401)
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "org_id": user.org_id,
            "name": user.name,
        },
        "token": token,
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
