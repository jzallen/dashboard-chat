"""add row_count column to datasets table

Revision ID: c0d1e2f3a4b5
Revises: b9c0d1e2f3a4
Create Date: 2026-05-07 06:30:00.000000

Surfaces the dataset's snapshotted row count on the GET response so callers
(including the staging-layer harness) don't have to fall back to
``len(preview)``. Nullable for legacy rows created before this column existed.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c0d1e2f3a4b5"  # pragma: allowlist secret
down_revision: Union[str, None] = "b9c0d1e2f3a4"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("row_count", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("datasets", "row_count")
