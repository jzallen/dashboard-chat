"""Add outbox_messages table for event sourcing

Revision ID: 006
Revises: 005
Create Date: 2026-02-02

Changes:
- Create outbox_messages table for event sourcing and reliable messaging
- Stores domain events for state reconstruction and future publishing
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade():
    """Add outbox_messages table."""

    op.create_table(
        'outbox_messages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('aggregate_type', sa.String(100), nullable=False),
        sa.Column('aggregate_id', sa.String(36), nullable=False),
        sa.Column('event_type', sa.String(100), nullable=False),
        sa.Column('payload', sa.JSON, nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column('processed', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('processed_at', sa.DateTime, nullable=True),
    )

    # Individual indexes
    op.create_index('ix_outbox_aggregate_type', 'outbox_messages', ['aggregate_type'])
    op.create_index('ix_outbox_aggregate_id', 'outbox_messages', ['aggregate_id'])
    op.create_index('ix_outbox_created_at', 'outbox_messages', ['created_at'])
    op.create_index('ix_outbox_processed', 'outbox_messages', ['processed'])

    # Composite index for efficient aggregate event queries
    op.create_index(
        'ix_outbox_aggregate_events',
        'outbox_messages',
        ['aggregate_type', 'aggregate_id', 'created_at'],
    )


def downgrade():
    """Remove outbox_messages table."""

    op.drop_index('ix_outbox_aggregate_events', 'outbox_messages')
    op.drop_index('ix_outbox_processed', 'outbox_messages')
    op.drop_index('ix_outbox_created_at', 'outbox_messages')
    op.drop_index('ix_outbox_aggregate_id', 'outbox_messages')
    op.drop_index('ix_outbox_aggregate_type', 'outbox_messages')
    op.drop_table('outbox_messages')
