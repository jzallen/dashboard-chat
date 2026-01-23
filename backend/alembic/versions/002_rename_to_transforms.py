"""Rename filter_pipelines table to transforms

Revision ID: 002
Revises: 001
Create Date: 2026-01-23

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001_initial_schema'
branch_labels = None
depends_on = None


def upgrade():
    """Rename filter_pipelines table and related indexes/constraints to transforms."""
    
    # Rename the table
    op.rename_table('filter_pipelines', 'transforms')
    
    # Rename indexes
    op.execute('DROP INDEX IF EXISTS ix_filter_pipelines_dataset_id')
    op.execute('DROP INDEX IF EXISTS ix_filter_pipelines_is_active')
    op.create_index('ix_transforms_dataset_id', 'transforms', ['dataset_id'])
    op.create_index('ix_transforms_is_active', 'transforms', ['is_active'])


def downgrade():
    """Revert transforms table back to filter_pipelines."""
    
    # Rename indexes back
    op.execute('DROP INDEX IF EXISTS ix_transforms_dataset_id')
    op.execute('DROP INDEX IF EXISTS ix_transforms_is_active')
    op.create_index('ix_filter_pipelines_dataset_id', 'filter_pipelines', ['dataset_id'])
    op.create_index('ix_filter_pipelines_is_active', 'filter_pipelines', ['is_active'])
    
    # Rename the table back
    op.rename_table('transforms', 'filter_pipelines')
