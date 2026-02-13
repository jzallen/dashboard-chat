"""Add organizations table

Revision ID: 011
Revises: 010
Create Date: 2026-02-13

Changes:
- Create organizations table: id (String(36), PK), name (String(255), NOT NULL),
  created_at (DateTime), updated_at (DateTime)
"""

from alembic import op
import sqlalchemy as sa

revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade():
    """Create organizations table."""
    op.create_table(
        'organizations',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=True),
        sa.Column('updated_at', sa.DateTime, nullable=True),
    )


def downgrade():
    """Drop organizations table."""
    op.drop_table('organizations')
