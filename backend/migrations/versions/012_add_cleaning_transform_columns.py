"""Add cleaning transform columns to transforms table

Revision ID: 012
Revises: 011
Create Date: 2026-02-15

Changes:
- Add transform_type (VARCHAR(20), NOT NULL, DEFAULT 'filter') to transforms
- Add target_column (VARCHAR(255), NULL) to transforms
- Add expression_sql (TEXT, NULL) to transforms
- Add expression_config (JSON, NULL) to transforms

All existing rows receive transform_type='filter' via the column default.
No data migration required — fully backward-compatible.
"""

from alembic import op
import sqlalchemy as sa

revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    """Add cleaning transform columns to transforms table."""
    op.add_column(
        'transforms',
        sa.Column('transform_type', sa.String(20), nullable=False, server_default='filter'),
    )
    op.add_column(
        'transforms',
        sa.Column('target_column', sa.String(255), nullable=True),
    )
    op.add_column(
        'transforms',
        sa.Column('expression_sql', sa.Text, nullable=True),
    )
    op.add_column(
        'transforms',
        sa.Column('expression_config', sa.JSON, nullable=True),
    )


def downgrade():
    """Remove cleaning transform columns from transforms table."""
    op.drop_column('transforms', 'expression_config')
    op.drop_column('transforms', 'expression_sql')
    op.drop_column('transforms', 'target_column')
    op.drop_column('transforms', 'transform_type')
