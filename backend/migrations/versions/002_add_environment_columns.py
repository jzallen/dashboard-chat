"""add environment columns to external_access

Revision ID: a1b2c3d4e5f6
Revises: 37527f1d9d35
Create Date: 2026-02-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '37527f1d9d35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('external_access', sa.Column('environment_id', sa.String(length=255), nullable=True))
    op.add_column('external_access', sa.Column('environment_host', sa.String(length=255), nullable=True))
    op.add_column('external_access', sa.Column('environment_port', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('external_access', 'environment_port')
    op.drop_column('external_access', 'environment_host')
    op.drop_column('external_access', 'environment_id')
