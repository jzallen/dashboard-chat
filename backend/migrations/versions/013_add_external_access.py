"""Add external_access table for external SQL access

Revision ID: 013
Revises: 012
Create Date: 2026-02-21

Changes:
- Create external_access table with project_id unique constraint
- Tracks pg_duckdb schema/role provisioning per project
"""

from alembic import op
import sqlalchemy as sa

revision = '013'
down_revision = '012'
branch_labels = None
depends_on = None


def upgrade():
    """Create external_access table."""
    op.create_table(
        'external_access',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), unique=True, nullable=False),
        sa.Column('org_id', sa.String(36), nullable=False, index=True),
        sa.Column('pg_schema', sa.String(255), nullable=False),
        sa.Column('pg_role', sa.String(255), nullable=False),
        sa.Column('pg_password_hash', sa.Text, nullable=False),
        sa.Column('enabled', sa.Boolean, nullable=False, server_default='1'),
        sa.Column('last_synced_at', sa.DateTime, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.Column('updated_at', sa.DateTime, nullable=False),
    )


def downgrade():
    """Drop external_access table."""
    op.drop_table('external_access')
