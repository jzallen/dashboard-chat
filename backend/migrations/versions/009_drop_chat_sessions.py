"""Drop chat_sessions and chat_turns tables

Revision ID: 009
Revises: 008
Create Date: 2026-02-12

Changes:
- Drop chat_turns table (must be dropped first due to FK)
- Drop chat_sessions table
- Sessions are now managed by the chat worker with Redis + S3
"""

from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    """Drop chat session tables — sessions moved to worker."""
    op.drop_index('ix_chat_turns_session_sequence', table_name='chat_turns')
    op.drop_table('chat_turns')
    op.drop_table('chat_sessions')


def downgrade():
    """Recreate chat session tables."""
    op.create_table(
        'chat_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('dataset_id', sa.String(36), sa.ForeignKey('datasets.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )

    op.create_table(
        'chat_turns',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('session_id', sa.String(36), sa.ForeignKey('chat_sessions.id'), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('user_message', sa.Text(), nullable=False),
        sa.Column('system_prompt', sa.Text(), nullable=False),
        sa.Column('tool_definitions', sa.JSON(), nullable=False),
        sa.Column('assistant_content', sa.Text(), nullable=True),
        sa.Column('tool_calls', sa.JSON(), nullable=True),
        sa.Column('tool_results', sa.JSON(), nullable=True),
        sa.Column('table_schema', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )

    op.create_index(
        'ix_chat_turns_session_sequence',
        'chat_turns',
        ['session_id', 'sequence'],
    )
