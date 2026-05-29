"""Auth middleware for FastAPI/Starlette.

Backend is a pure **resource server** (ADR-016 / ADR-043): auth-proxy is the
single ingress and the single home for token verification *and* issuance. Every
request that reaches backend has already been authenticated upstream by
auth-proxy, which injects the verified identity as ``X-User-Id`` / ``X-Org-Id``
/ ``X-User-Email`` headers. This middleware trusts those headers and sets the
auth context; it does NOT verify JWTs (that role moved to auth-proxy when the
backend ceased to mint tokens — ADR-043 stage 3).
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .context import set_auth_user
from .types import AuthUser

logger = logging.getLogger(__name__)

PUBLIC_PATHS = {
    "/health",
    "/",
    "/docs",
    "/openapi.json",
    "/redoc",
}


class AuthMiddleware(BaseHTTPMiddleware):
    """Trust the auth-proxy-injected identity headers and set the auth context."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth for public routes
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # Resource-server path: identity comes from the auth-proxy-injected
        # headers. There is no direct-JWT-verification fallback — backend no
        # longer holds a verification keypair (ADR-043 stage 3).
        user_id = request.headers.get("X-User-Id")
        if not user_id:
            return JSONResponse(
                {"detail": "Missing identity headers"},
                status_code=401,
            )

        set_auth_user(
            AuthUser(
                id=user_id,
                org_id=request.headers.get("X-Org-Id"),
                email=request.headers.get("X-User-Email", ""),
            )
        )
        return await call_next(request)
