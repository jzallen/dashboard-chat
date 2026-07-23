"""add cold-storage columns (archived_at, retention_until) to sources table

Recoverable Cold Storage for sources: archive a source and it leaves the live
catalog; restore brings it back. Add two nullable timestamp columns:
``archived_at`` (set when archived) and ``retention_until`` (= archived_at + the
90-day retention window, computed at archive time). Both are cleared on restore.
List endpoints default-exclude rows where ``archived_at IS NOT NULL``;
``?archived=true`` returns only the cold-storage list.

Portable across SQLite (dev) + PostgreSQL (prod): plain nullable ``add_column``
calls (no ``alter_column``, no batch op). Nullable for legacy rows created before
these columns existed. No index added — the ``sources`` table has no ``org_id``
column (it is org-scoped transitively via ``project_id``, already indexed), so the
org_id-index requirement does not apply. Mirrors 015_add_dataset_cold_storage.py.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"  # pragma: allowlist secret
down_revision: Union[str, None] = "b0c1d2e3f4a5"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sources", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.add_column("sources", sa.Column("retention_until", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("sources", "retention_until")
    op.drop_column("sources", "archived_at")
