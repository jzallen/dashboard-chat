"""Add auth columns to projects table

Revision ID: 010
Revises: 009
Create Date: 2026-02-12

Changes:
- Add org_id column (String(36), nullable, indexed) to projects
- Add created_by column (String(36), nullable) to projects
"""

from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade():
    """Add org_id and created_by columns for multi-tenant auth."""
    op.add_column('projects', sa.Column('org_id', sa.String(36), nullable=True))
    op.add_column('projects', sa.Column('created_by', sa.String(36), nullable=True))
    op.create_index('ix_projects_org_id', 'projects', ['org_id'])


def downgrade():
    """Remove auth columns from projects."""
    op.drop_index('ix_projects_org_id', table_name='projects')
    op.drop_column('projects', 'created_by')
    op.drop_column('projects', 'org_id')
