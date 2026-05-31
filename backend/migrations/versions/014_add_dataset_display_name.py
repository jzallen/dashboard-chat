"""add display_name column to datasets table

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-05-31 20:10:00.000000

MR-6 (pipeline-layers-ui-redesign): the "source" concept is a thin extension of
the existing dataset record — an editable display name distinct from the filename.
Add a single nullable ``display_name`` column; the UI falls back to ``name`` when
it is unset, and the underlying filename/``name`` is never mutated by a display-name
edit.

Portable across SQLite (dev) + PostgreSQL (prod): a plain nullable ``add_column``
(no ``alter_column``, no batch op). Nullable for legacy rows created before this
column existed. Mirrors 010_add_dataset_row_count.py.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a4b5c6d7e8f9"  # pragma: allowlist secret
down_revision: Union[str, None] = "f3a4b5c6d7e8"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("display_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("datasets", "display_name")
