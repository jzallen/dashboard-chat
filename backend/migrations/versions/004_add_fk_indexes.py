"""add indexes on datasets.project_id and transforms.dataset_id

Revision ID: c4d5e6f7a8c0
Revises: c4d5e6f7a8b9
Create Date: 2026-03-06 12:00:00.000000

Linearization fix (2026-05-13): this revision and
``004_add_dataset_format_context`` were originally both authored with
``revision = "c4d5e6f7a8b9"`` from concurrent feature branches, which
left the alembic chain with two heads. Renumbering this migration to a
fresh ID (``c4d5e6f7a8c0``) and chaining it after the dataset-format-
context migration linearizes the fork. Prod ``alembic_version`` stores
only the latest applied revision (currently downstream of both 004s),
so this rename has no production migration-table impact.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8c0'  # pragma: allowlist secret
down_revision: Union[str, None] = 'c4d5e6f7a8b9'  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_datasets_project_id', 'datasets', ['project_id'])
    op.create_index('ix_transforms_dataset_id', 'transforms', ['dataset_id'])


def downgrade() -> None:
    op.drop_index('ix_transforms_dataset_id', table_name='transforms')
    op.drop_index('ix_datasets_project_id', table_name='datasets')
