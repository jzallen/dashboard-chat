"""add model_name column to datasets table + backfill

Revision ID: b0c1d2e3f4a5
Revises: f9a0b1c2d3e4
Create Date: 2026-06-14 00:00:00.000000

Dataset-identity slice B: give each dataset a persisted ``model_name`` — the
dbt machine name (e.g. display "Customers" -> ``stg_customers``) — derived from
``display_name`` ONCE at creation and DECOUPLED thereafter (a later display-name
edit never reconciles into it).

Additive only: all staging-model bindings are already UUID-keyed, so there is no
ref migration. Add a single nullable ``model_name`` column (no unique constraint
— existing data may collide; no ``org_id`` index — datasets are org-scoped via
``project_id``). Portable across SQLite (dev) + PostgreSQL (prod): a plain
nullable ``add_column`` (no ``alter_column``, no batch op). Mirrors
014_add_dataset_display_name.py.

Backfill: every existing row is set to ``stg_<snake(COALESCE(display_name,
name))>``. The snake derivation here MUST match
``app.use_cases.dataset._pipeline.ingestion.stg_model_name`` byte-for-byte
(which composes ``app.use_cases.project._dbt.naming.to_snake_case``): lowercase,
fold every non-``[a-z0-9]`` run to a single ``_``, strip leading/trailing ``_``,
fall back to ``"dataset"`` when empty, then prefix ``stg_`` UNLESS the snake root
already starts with ``stg_``. The logic is inlined (not imported) to keep the
migration self-contained and stable against future app-code changes.
"""

import re
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0c1d2e3f4a5"  # pragma: allowlist secret
down_revision: Union[str, None] = "f9a0b1c2d3e4"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _stg_model_name(display_name: str | None) -> str:
    """Byte-for-byte mirror of ``stg_model_name`` (see module docstring)."""
    root = re.sub(r"[^a-z0-9]+", "_", (display_name or "").lower()).strip("_") or "dataset"
    if root.startswith("stg_"):
        return root
    return f"stg_{root}"


def upgrade() -> None:
    op.add_column("datasets", sa.Column("model_name", sa.String(length=255), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, COALESCE(display_name, name) AS source FROM datasets")
    ).fetchall()
    for row in rows:
        bind.execute(
            sa.text("UPDATE datasets SET model_name = :model_name WHERE id = :id"),
            {"model_name": _stg_model_name(row.source), "id": row.id},
        )


def downgrade() -> None:
    op.drop_column("datasets", "model_name")
