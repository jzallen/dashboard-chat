"""add project_memories and sessions tables

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-03-31 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f3"  # pragma: allowlist secret
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_memories",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("stream_channel_id", sa.String(length=100), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_project_memories_org_id", "project_memories", ["org_id"])

    op.create_table(
        "sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("memory_id", sa.String(length=36), sa.ForeignKey("project_memories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stream_thread_id", sa.String(length=100), nullable=False),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_active_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_sessions_memory_id", "sessions", ["memory_id"])
    op.create_index("ix_sessions_owner_id", "sessions", ["owner_id"])
    op.create_index("ix_sessions_org_id", "sessions", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_org_id", table_name="sessions")
    op.drop_index("ix_sessions_owner_id", table_name="sessions")
    op.drop_index("ix_sessions_memory_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_project_memories_org_id", table_name="project_memories")
    op.drop_table("project_memories")
