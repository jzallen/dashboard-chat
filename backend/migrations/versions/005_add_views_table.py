"""add views table

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-03-06 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"  # pragma: allowlist secret
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "views",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sql_definition", sa.Text(), nullable=False),
        sa.Column("source_refs", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("materialization", sa.String(length=20), nullable=False, server_default="ephemeral"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_views_org_id", "views", ["org_id"])
    op.create_index("ix_views_project_id", "views", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_views_project_id", table_name="views")
    op.drop_index("ix_views_org_id", table_name="views")
    op.drop_table("views")
