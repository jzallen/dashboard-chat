"""Auth middleware for FastAPI/Starlette."""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import enrich_org_id, get_auth_provider
from .context import set_auth_user

logger = logging.getLogger(__name__)

PUBLIC_PATHS = {
    "/health",
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/auth/login",
    "/api/auth/callback",
    "/api/auth/logout",
    "/api/auth/refresh",
}

# Paths accessible to authenticated users even without an org
ORG_LESS_PATHS = {
    "/api/orgs",
    "/api/orgs/me",
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
        except Exception as e:
            logger.error("Token verification failed for %s: %s", path, e)
            return JSONResponse(
                {"detail": "Invalid or expired token"},
                status_code=401,
            )

        # Enrich org_id from local DB when JWT doesn't include it
        user = await enrich_org_id(user)

        set_auth_user(user)

        # Authenticated but org-less users can only access org endpoints and auth
        if user.org_id is None and path not in ORG_LESS_PATHS:
            return JSONResponse(
                {"detail": "Organization required"},
                status_code=403,
            )

        return await call_next(request)
