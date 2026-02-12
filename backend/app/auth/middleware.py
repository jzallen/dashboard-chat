"""Auth middleware for FastAPI/Starlette."""

import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .context import set_auth_user
from . import get_auth_provider

logger = logging.getLogger(__name__)

PUBLIC_PATHS = {
    "/health", "/", "/docs", "/openapi.json", "/redoc",
    "/api/auth/login", "/api/auth/callback", "/api/auth/logout",
}


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware that validates Bearer tokens and sets auth context."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth for public routes
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # Extract Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                {"detail": "Missing or invalid Authorization header"},
                status_code=401,
            )

        token = auth_header[7:]

        try:
            provider = get_auth_provider()
            user = await provider.verify_token(token)
            set_auth_user(user)
        except Exception as e:
            logger.error("Token verification failed for %s: %s", path, e)
            return JSONResponse(
                {"detail": "Invalid or expired token"},
                status_code=401,
            )

        return await call_next(request)
