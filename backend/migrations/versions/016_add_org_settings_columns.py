"""add org-settings columns to organizations table

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-06-06 00:00:00.000000

OrgSettings (rich-catalog-backend-models §1): the org aggregate gains a small
configuration value object — ``slug`` + ``region`` + three modelling
``defaults`` (engine / materialization / model_prefix) — persisted as columns on
``organizations`` (a 1:1 value object owned by the root gets columns, not its own
table). ``plan``/``seats``/``used_seats`` are NOT modelled (no billing domain);
``members`` is derived self-only from the request's AuthUser. Both are emitted as
stubs at the response boundary, so no schema change for them.

Portable across SQLite (dev) + PostgreSQL (prod): plain nullable / server-default
``add_column`` calls — no ``alter_column``, no batch op. ``slug`` is nullable (a
future settings-edit flow sets it; the mapper falls back to a slugified ``name``
when null, so no data backfill step is needed). ``region`` and the three
``default_*`` columns are NOT NULL with server defaults so existing rows backfill
to the same values the application treats as defaults. No index added —
``organizations.id`` IS the org id (PK, already indexed), so the org_id-index
requirement does not apply. Mirrors 015_add_dataset_cold_storage.py.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6d7e8f9a0b1"  # pragma: allowlist secret
down_revision: Union[str, None] = "b5c6d7e8f9a0"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("slug", sa.String(255), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("region", sa.String(64), nullable=False, server_default="us-east-1"),
    )
    op.add_column(
        "organizations",
        sa.Column("default_engine", sa.String(64), nullable=False, server_default="duckdb"),
    )
    op.add_column(
        "organizations",
        sa.Column(
            "default_materialization", sa.String(32), nullable=False, server_default="view"
        ),
    )
    op.add_column(
        "organizations",
        sa.Column("default_model_prefix", sa.String(64), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("organizations", "default_model_prefix")
    op.drop_column("organizations", "default_materialization")
    op.drop_column("organizations", "default_engine")
    op.drop_column("organizations", "region")
    op.drop_column("organizations", "slug")
