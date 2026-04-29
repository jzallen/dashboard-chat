"""Read/write helpers for the idempotency-key cache."""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .record import IdempotencyKeyRecord

DEFAULT_TTL = timedelta(hours=24)


def hash_body(body: bytes) -> str:
    """SHA-256 of the raw request body, used to detect key reuse with mismatched payload."""
    return hashlib.sha256(body).hexdigest()


def _utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class IdempotencyHit:
    """Cached response for a previously-seen idempotency key."""

    __slots__ = ("body", "body_hash", "status")

    def __init__(self, status: int, body: Any, body_hash: str) -> None:
        self.status = status
        self.body = body
        self.body_hash = body_hash


class IdempotencyStore:
    """SQLAlchemy-backed cache for idempotent responses."""

    def __init__(self, session: AsyncSession, ttl: timedelta = DEFAULT_TTL) -> None:
        self._session = session
        self._ttl = ttl

    async def lookup(
        self,
        *,
        user_id: str,
        org_id: str,
        endpoint: str,
        key: str,
    ) -> IdempotencyHit | None:
        """Return the cached response for `(user, org, endpoint, key)` if any, else None.

        Records older than the TTL are ignored (and may be reaped later).
        """
        cutoff = _utcnow_naive() - self._ttl
        stmt = select(IdempotencyKeyRecord).where(
            IdempotencyKeyRecord.user_id == user_id,
            IdempotencyKeyRecord.org_id == org_id,
            IdempotencyKeyRecord.endpoint == endpoint,
            IdempotencyKeyRecord.idempotency_key == key,
            IdempotencyKeyRecord.created_at >= cutoff,
        )
        result = await self._session.execute(stmt)
        rec = result.scalar_one_or_none()
        if rec is None:
            return None
        return IdempotencyHit(
            status=rec.response_status,
            body=rec.response_body,
            body_hash=rec.request_body_hash,
        )

    async def store(
        self,
        *,
        user_id: str,
        org_id: str,
        endpoint: str,
        key: str,
        body_hash: str,
        response_status: int,
        response_body: Any,
    ) -> None:
        """Persist `(user, org, endpoint, key) -> response`. Best-effort.

        If a concurrent request already inserted the same scope (UNIQUE
        violation), this swallows the conflict — the prior writer's record
        becomes the cached response.
        """
        record = IdempotencyKeyRecord(
            user_id=user_id,
            org_id=org_id,
            endpoint=endpoint,
            idempotency_key=key,
            request_body_hash=body_hash,
            response_status=response_status,
            response_body=response_body,
            created_at=_utcnow_naive(),
        )
        self._session.add(record)
        try:
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
