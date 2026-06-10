"""add created_by column to organizations table

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-06-10 00:00:00.000000

org-onboarding S1 (design D1): a nullable ``created_by`` (owner user id,
String(36)) on ``organizations`` is the DB link between a user and the org
they create. Later steps stamp it on create and resolve org identity from it
under DEV_NO_ORG; it never appears on any wire response (UI-4 invariant).

Portable across SQLite (dev) + PostgreSQL (prod): plain nullable ``add_column``
on upgrade, real ``drop_column`` on downgrade — no ``alter_column``, no batch
op, no data backfill. Existing rows remain valid as NULL (no default). No index
added — lookups by ``created_by`` are a dev-mode fallback path, not a hot scan.
Mirrors 016_add_org_settings_columns.py (``slug``).
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8f9a0b1c2d3"  # pragma: allowlist secret
down_revision: Union[str, None] = "d7e8f9a0b1c2"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("created_by", sa.String(36), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "created_by")
