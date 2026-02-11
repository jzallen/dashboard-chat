"""Add column_profiles to datasets table

Revision ID: 007
Revises: 006
Create Date: 2026-02-11

Changes:
- Add nullable JSON column column_profiles to datasets table
- Stores per-column profiling data for LLM context
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    """Add column_profiles column to datasets table."""
    op.add_column('datasets', sa.Column('column_profiles', sa.JSON(), nullable=True))


def downgrade():
    """Remove column_profiles column from datasets table."""
    op.drop_column('datasets', 'column_profiles')
