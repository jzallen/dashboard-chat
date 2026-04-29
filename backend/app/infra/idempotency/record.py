"""ORM record for cached idempotency-key responses."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class IdempotencyKeyRecord(Base):
    """Cached `(user, org, endpoint, key) -> response` for retry deduplication.

    Scoping is per `(user_id, org_id, endpoint)` so the same key reused on a
    different endpoint is a different record. ``request_body_hash`` lets the
    middleware reject reuse with a mismatched payload (-> 409).
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "org_id",
            "endpoint",
            "idempotency_key",
            name="uq_idempotency_keys_scope",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        server_default=text("(uuidv7())"),
    )
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    org_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    request_body_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    response_body: Mapped[Any] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC).replace(tzinfo=None),
        nullable=False,
        index=True,
    )
