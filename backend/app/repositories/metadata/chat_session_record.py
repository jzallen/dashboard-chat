"""Chat session and turn ORM records for persistence layer.

Note: The authoritative ChatSession/ChatTurn are the domain models in app/models/.
These are just for database persistence.
"""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ...database import Base

if TYPE_CHECKING:
    from .dataset_record import DatasetRecord


class ChatSessionRecord(Base):
    """Chat session ORM record for persistence only."""

    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    dataset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("datasets.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    # Relationships
    turns: Mapped[list["ChatTurnRecord"]] = relationship(
        "ChatTurnRecord", back_populates="session", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ChatSessionRecord(id={self.id}, dataset_id={self.dataset_id})>"


class ChatTurnRecord(Base):
    """Chat turn ORM record for persistence only."""

    __tablename__ = "chat_turns"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid4()),
    )
    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("chat_sessions.id"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    user_message: Mapped[str] = mapped_column(Text, nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    tool_definitions: Mapped[dict] = mapped_column(JSON, nullable=False)
    assistant_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_calls: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tool_results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    table_schema: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )

    # Relationships
    session: Mapped["ChatSessionRecord"] = relationship(
        "ChatSessionRecord", back_populates="turns"
    )

    def __repr__(self) -> str:
        return f"<ChatTurnRecord(id={self.id}, session_id={self.session_id}, sequence={self.sequence})>"
