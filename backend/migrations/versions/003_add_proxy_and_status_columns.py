"""add proxy_container_id, environment_status, status_message to external_access

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-02-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('external_access', sa.Column('proxy_container_id', sa.String(length=255), nullable=True))
    op.add_column('external_access', sa.Column('environment_status', sa.String(length=50), server_default='running', nullable=False))
    op.add_column('external_access', sa.Column('status_message', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('external_access', 'status_message')
    op.drop_column('external_access', 'environment_status')
    op.drop_column('external_access', 'proxy_container_id')
