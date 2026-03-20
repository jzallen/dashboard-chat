"""add structured columns to views table

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-03-19 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"  # pragma: allowlist secret
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("views", sa.Column("columns", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("views", sa.Column("joins", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("views", sa.Column("filters", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("views", sa.Column("grain", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("views", "grain")
    op.drop_column("views", "filters")
    op.drop_column("views", "joins")
    op.drop_column("views", "columns")
