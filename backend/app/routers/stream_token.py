"""Stream.io token endpoint — mints JWT tokens for authenticated users."""

import time

import jwt
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.auth.context import get_auth_user
from app.config import get_settings

router = APIRouter(prefix="/api/stream", tags=["stream"])


@router.get("/stream-token")
async def stream_token():
    """Mint a Stream.io JWT for the authenticated user.

    Auth is enforced by AuthMiddleware (Bearer token required).
    """
    settings = get_settings()

    if not settings.stream_api_key or not settings.stream_api_secret:
        return JSONResponse(
            {"detail": "Stream.io is not configured"},
            status_code=503,
        )

    user = get_auth_user()

    now = int(time.time())
    payload = {
        "user_id": user.id,
        "iat": now,
        "exp": now + 3600,
    }
    token = jwt.encode(payload, settings.stream_api_secret, algorithm="HS256")

    return {"token": token}
