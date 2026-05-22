"""add unique constraint on organizations.name

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-05-22 00:00:00.000000

Org names are globally unique (each user belongs to one org; users can share an
org). Enforce it at the DB via a UNIQUE index on ``organizations.name``, which
also makes the create-time name-availability point lookup cheap.

Portable across SQLite (dev) + PostgreSQL (prod): a UNIQUE index via
``op.create_index(..., unique=True)`` — NOT ``op.create_unique_constraint`` /
``op.alter_column`` (SQLite cannot ``ALTER TABLE ADD CONSTRAINT``).

Assumes no existing duplicate names (no production deployment; fresh dev/test
DBs). If real data with duplicate org names ever exists, a dedupe pre-step
(renaming collisions) must run before this index can be created.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a4b5c6d7e8"  # pragma: allowlist secret
down_revision: Union[str, None] = "e2f3a4b5c6d7"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("uq_organizations_name", "organizations", ["name"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_organizations_name", table_name="organizations")
