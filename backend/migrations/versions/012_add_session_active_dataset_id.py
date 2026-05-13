"""add active_dataset_id column to sessions table

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-05-13 13:30:00.000000

Per J-002 DESIGN wave-decision DWD-2 (`docs/feature/project-and-chat-
session-management/design/wave-decisions.md`): adds a single nullable
column tracking the dataset that was active when a chat session was
last touched. Used by US-205 (session resume restores transcript and
dataset) and US-209 (dataset context switching persists across resume).

Storage shape: single-value (current active dataset), no history. DWD-2
ratified this as Option A over a side-log table (Option B) and event-
stream denormalization (Option C); history queries are out of scope for
J-002. If a future feature requires attachment history, the column-to-
side-log forward migration is bounded — existing data becomes the
latest row in the side-log; no data loss.

Forward-only in prod (DWD-2 corollary). The ``downgrade()`` here is a
dev-environment escape hatch only.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"  # pragma: allowlist secret
down_revision: Union[str, None] = "d1e2f3a4b5c6"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("active_dataset_id", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_sessions_active_dataset_id", "sessions", ["active_dataset_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_active_dataset_id", table_name="sessions")
    op.drop_column("sessions", "active_dataset_id")
