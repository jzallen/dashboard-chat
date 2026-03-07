"""add reports table

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-03-06 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e6f7a8b9c0d1"  # pragma: allowlist secret
down_revision: Union[str, None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("project_id", sa.String(length=36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sql_definition", sa.Text(), nullable=False),
        sa.Column("source_refs", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("report_type", sa.String(length=20), nullable=False),
        sa.Column("domain", sa.String(length=100), nullable=False, server_default="Organization"),
        sa.Column("columns_metadata", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("materialization", sa.String(length=20), nullable=False, server_default="view"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_reports_org_id", "reports", ["org_id"])
    op.create_index("ix_reports_project_id", "reports", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_project_id", table_name="reports")
    op.drop_index("ix_reports_org_id", table_name="reports")
    op.drop_table("reports")
