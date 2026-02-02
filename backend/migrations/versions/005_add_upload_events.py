"""Add upload_events table and partition_fields to datasets

Revision ID: 005
Revises: 004
Create Date: 2026-02-02

Changes:
- Create upload_events table for tracking file uploads
- Add partition_fields column to datasets table
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    """Add upload_events table and partition_fields column."""

    # 1. Create upload_events table
    op.create_table(
        'upload_events',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('dataset_id', sa.String(36), sa.ForeignKey('datasets.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.Enum('pending', 'processing', 'completed', 'failed', name='upload_status'), nullable=False, server_default='pending'),
        sa.Column('raw_storage_path', sa.String(255), nullable=False, unique=True),
        sa.Column('original_filename', sa.String(255), nullable=False),
        sa.Column('file_size', sa.Integer, nullable=False),
        sa.Column('schema_config', sa.JSON, nullable=False, server_default='{}'),
        sa.Column('row_count', sa.Integer, nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('processed_at', sa.DateTime, nullable=True),
    )

    # 2. Add indexes to upload_events
    op.create_index('ix_upload_events_project_id', 'upload_events', ['project_id'])
    op.create_index('ix_upload_events_dataset_id', 'upload_events', ['dataset_id'])
    op.create_index('ix_upload_events_raw_storage_path', 'upload_events', ['raw_storage_path'])

    # 3. Add partition_fields column to datasets
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.add_column(sa.Column('partition_fields', sa.JSON, nullable=False, server_default='[]'))


def downgrade():
    """Remove upload_events table and partition_fields column."""

    # 1. Remove partition_fields from datasets
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.drop_column('partition_fields')

    # 2. Drop indexes
    op.drop_index('ix_upload_events_raw_storage_path', 'upload_events')
    op.drop_index('ix_upload_events_dataset_id', 'upload_events')
    op.drop_index('ix_upload_events_project_id', 'upload_events')

    # 3. Drop upload_events table
    op.drop_table('upload_events')

    # 4. Drop the enum type
    op.execute("DROP TYPE IF EXISTS upload_status")
