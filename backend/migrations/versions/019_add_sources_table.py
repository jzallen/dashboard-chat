"""add sources table + nullable datasets.source_id

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-06-11 00:00:00.000000

Source aggregate (slice 1): a ``Source`` is a logical table backed by one or
more uploaded files sharing a schema (dbt-style). Its public SELECT * view is a
``Dataset`` linked back via the new nullable ``datasets.source_id`` column.

Org scoping is transitive via ``project_id`` (the projects table carries
``org_id``), so per the ``alembic-migration`` skill there is NO ``org_id``
column or index here — only ``project_id`` is indexed.

Portable across SQLite (dev) + PostgreSQL (prod): plain ``create_table`` +
``add_column`` (no ``alter_column``, no batch op). ``(uuidv7())`` server
default + ``CURRENT_TIMESTAMP`` defaults mirror the existing tables. The new
``datasets.source_id`` is a plain nullable ``String(36)`` with an index so
legacy datasets (created before the Source aggregate) survive as NULL; nothing
writes it yet. Both objects are reversed in ``downgrade()``.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"  # pragma: allowlist secret
down_revision: Union[str, None] = "e8f9a0b1c2d3"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) the sources table — scoped transitively via project_id (CASCADE on
    #    project delete), no org_id column/index.
    op.create_table(
        "sources",
        sa.Column("id", sa.String(36), nullable=False, server_default=sa.text("(uuidv7())")),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("schema_config", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sources_project_id", "sources", ["project_id"])

    # 2) the nullable link on datasets — plain add_column + index (SQLite-safe,
    #    no batch). Nullable so legacy datasets survive; nothing writes it yet.
    op.add_column("datasets", sa.Column("source_id", sa.String(36), nullable=True))
    op.create_index("ix_datasets_source_id", "datasets", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_datasets_source_id", table_name="datasets")
    op.drop_column("datasets", "source_id")

    op.drop_index("ix_sources_project_id", table_name="sources")
    op.drop_table("sources")
