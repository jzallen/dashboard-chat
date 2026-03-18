"""add indexes on datasets.project_id and transforms.dataset_id

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-03-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_datasets_project_id', 'datasets', ['project_id'])
    op.create_index('ix_transforms_dataset_id', 'transforms', ['dataset_id'])


def downgrade() -> None:
    op.drop_index('ix_transforms_dataset_id', table_name='transforms')
    op.drop_index('ix_datasets_project_id', table_name='datasets')
