"""Helper to wrap FastAPI mutation endpoints with Idempotency-Key support."""

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.types import AuthUser
from app.controllers.response_wrapper import wrap_jsonapi_error

from .store import IdempotencyStore, hash_body

Handler = Callable[[], Awaitable[tuple[dict[str, Any], int]]]


def _conflict_body(key: str) -> dict[str, Any]:
    return wrap_jsonapi_error(
        409,
        "Idempotency Key Conflict",
        f"Idempotency-Key '{key}' was previously used with a different request body.",
    )


async def idempotent_request(
    *,
    request: Request,
    db: AsyncSession,
    user: AuthUser,
    endpoint_id: str,
    handler: Handler,
) -> JSONResponse:
    """Wrap `handler` with Idempotency-Key support.

    Behavior:
      - No `Idempotency-Key` header: handler runs as usual; nothing is cached.
      - Header present, key unseen: handler runs; on 2xx the (status, body) is cached.
      - Header present, key seen with same body hash: cached (status, body) is returned.
      - Header present, key seen with different body hash: 409 Conflict.

    The cache is scoped to `(user_id, org_id, endpoint_id, key)`. Org-less
    requests fall through to the no-cache path so we never store records
    without a tenant.
    """
    key = request.headers.get("Idempotency-Key")
    if not key or not user.org_id:
        body, status = await handler()
        return JSONResponse(content=body, status_code=status)

    raw_body = await request.body()
    body_hash = hash_body(raw_body)
    store = IdempotencyStore(db)

    cached = await store.lookup(
        user_id=user.id,
        org_id=user.org_id,
        endpoint=endpoint_id,
        key=key,
    )
    if cached is not None:
        if cached.body_hash != body_hash:
            return JSONResponse(content=_conflict_body(key), status_code=409)
        return JSONResponse(content=cached.body, status_code=cached.status)

    body, status = await handler()

    if 200 <= status < 300:
        await store.store(
            user_id=user.id,
            org_id=user.org_id,
            endpoint=endpoint_id,
            key=key,
            body_hash=body_hash,
            response_status=status,
            response_body=body,
        )
    return JSONResponse(content=body, status_code=status)
