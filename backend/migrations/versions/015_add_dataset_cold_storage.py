"""add cold-storage columns (archived_at, retention_until) to datasets table

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-05-31 23:35:00.000000

MR-7 (pipeline-layers-ui-redesign): cold storage / retention. The "source" concept is a
thin extension of the existing dataset record — archive a source to cold storage and it
leaves the live lineage; restore brings it back. Add two nullable timestamp columns:
``archived_at`` (set when archived) and ``retention_until`` (= archived_at + the 90-day
retention window, computed server-side at archive time). Both are cleared on restore. List
endpoints default-exclude rows where ``archived_at IS NOT NULL``; ``?archived=true`` returns
only the cold-storage list. days-left is derived frontend-side from ``retention_until``.

Portable across SQLite (dev) + PostgreSQL (prod): plain nullable ``add_column`` calls
(no ``alter_column``, no batch op). Nullable for legacy rows created before these columns
existed. No index added — the ``datasets`` table has no ``org_id`` column (it is org-scoped
transitively via ``project_id``, already indexed), so the org_id-index requirement does not
apply. Mirrors 014_add_dataset_display_name.py.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c6d7e8f9a0"  # pragma: allowlist secret
down_revision: Union[str, None] = "a4b5c6d7e8f9"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column("datasets", sa.Column("retention_until", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("datasets", "retention_until")
    op.drop_column("datasets", "archived_at")
