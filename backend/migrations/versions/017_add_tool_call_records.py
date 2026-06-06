"""add tool_call_records spine + reversed FK on transforms

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-06-06 00:00:00.000000

ToolCallRecord (rich-catalog-backend-models §2.3 / §2.10): a GENERIC tool-call
audit spine — scoping columns (``org_id``/``project_id``/``node_id``/
``node_kind``) plus a single JSON ``payload`` carrying the variable tool content
(``{tool, say, tag, args?}``). NO per-subtype columns. The FK is REVERSED: the
detail (``Transform``) points UP at the spine via ``transforms.tool_call_id``,
not the other way round.

Portable across SQLite (dev) + PostgreSQL (prod): ``sa.Text`` + ``sa.JSON``
(TEXT under SQLite, JSON/JSONB under PG), ``(uuidv7())`` server default,
``CURRENT_TIMESTAMP`` default, and ``org_id`` indexed (every read filters by it).
The ``transforms`` alter is wrapped in ``op.batch_alter_table`` so adding the
nullable FK column + its index is portable under SQLite's limited ALTER support;
``ON DELETE SET NULL`` downgrades a transform to "no recorded provenance" rather
than deleting it when its tool-call record is removed.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"  # pragma: allowlist secret
down_revision: Union[str, None] = "c6d7e8f9a0b1"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) the generic spine — scoping columns + a JSON payload, NO per-subtype columns.
    op.create_table(
        "tool_call_records",
        sa.Column("id", sa.Text(), nullable=False, server_default=sa.text("(uuidv7())")),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("project_id", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("node_kind", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_call_records_org_id", "tool_call_records", ["org_id"])
    op.create_index("ix_tool_call_records_project_id", "tool_call_records", ["project_id"])
    op.create_index("ix_tool_call_records_node_id", "tool_call_records", ["node_id"])

    # 2) the REVERSED FK — the detail (Transform) points UP at the spine.
    with op.batch_alter_table("transforms", schema=None) as batch_op:
        batch_op.add_column(sa.Column("tool_call_id", sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            "fk_transforms_tool_call_id",
            "tool_call_records",
            ["tool_call_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_transforms_tool_call_id", ["tool_call_id"])


def downgrade() -> None:
    with op.batch_alter_table("transforms", schema=None) as batch_op:
        batch_op.drop_index("ix_transforms_tool_call_id")
        batch_op.drop_constraint("fk_transforms_tool_call_id", type_="foreignkey")
        batch_op.drop_column("tool_call_id")

    op.drop_index("ix_tool_call_records_node_id", table_name="tool_call_records")
    op.drop_index("ix_tool_call_records_project_id", table_name="tool_call_records")
    op.drop_index("ix_tool_call_records_org_id", table_name="tool_call_records")
    op.drop_table("tool_call_records")
