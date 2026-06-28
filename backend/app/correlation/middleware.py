"""Bind the request correlation id at the top of the FastAPI stack.

auth-proxy mints the id and forwards it on ``X-Request-Id``; the backend reads
that header and binds it to the ``correlation_id`` ``ContextVar`` for the whole
request, so every log line — including ones emitted deep inside a use case —
carries it. A bare ``uuid4`` is minted only when the header is absent (a direct
or test call that did not traverse the proxy), preserving the mint-once
invariant on the normal path.
"""

from __future__ import annotations

import logging
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .context import clear_correlation_id, set_correlation_id

logger = logging.getLogger("app.correlation")

REQUEST_ID_HEADER = "X-Request-Id"


class CorrelationMiddleware(BaseHTTPMiddleware):
    """Read/mint the correlation id and bind it for the request scope."""

    async def dispatch(self, request: Request, call_next):
        correlation_id = request.headers.get(REQUEST_ID_HEADER) or str(uuid.uuid4())
        set_correlation_id(correlation_id)
        try:
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = correlation_id
            return response
        finally:
            logger.info(
                "request.handled",
                extra={"method": request.method, "path": request.url.path},
            )
            clear_correlation_id()
