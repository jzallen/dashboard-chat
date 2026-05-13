"""add query_engine_nodes table and update external_access

Revision ID: a8b9c0d1e2f4
Revises: a8b9c0d1e2f3
Create Date: 2026-03-31 12:00:00.000000

Linearization fix (2026-05-13): this revision and
``008_add_project_memories_and_sessions`` were originally both authored
with ``revision = "a8b9c0d1e2f3"`` from concurrent feature branches, which
left the alembic chain with two heads and triggered "Revision is present
more than once" warnings. Renumbering this migration to a fresh ID
(``a8b9c0d1e2f4``) and chaining it after the sessions migration
linearizes the fork. Prod ``alembic_version`` stores only the latest
applied revision (currently ``d1e2f3a4b5c6`` for migration 011, which is
downstream of both 008s), so this rename has no production migration-
table impact.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f4"  # pragma: allowlist secret
down_revision: Union[str, None] = "a8b9c0d1e2f3"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create query_engine_nodes table
    op.create_table(
        "query_engine_nodes",
        sa.Column("id", sa.String(length=36), server_default=sa.text("(uuidv7())"), nullable=False),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("database", sa.String(length=255), nullable=False),
        sa.Column("admin_user", sa.String(length=255), nullable=False),
        sa.Column("admin_password_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), server_default="running", nullable=False),
        sa.Column("status_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "name", name="uq_query_engine_nodes_org_name"),
    )
    op.create_index("ix_query_engine_nodes_org_id", "query_engine_nodes", ["org_id"])

    # Add new columns to external_access
    op.add_column(
        "external_access",
        sa.Column("engine_node_id", sa.String(length=36), nullable=True),
    )
    op.add_column(
        "external_access",
        sa.Column("pg_proxy_role", sa.String(length=255), nullable=True),
    )

    # Add FK and index for engine_node_id (skip on SQLite — no ALTER TABLE ADD CONSTRAINT)
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_external_access_engine_node_id",
            "external_access",
            "query_engine_nodes",
            ["engine_node_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_external_access_engine_node_id", "external_access", ["engine_node_id"])

    # Drop old environment columns (skip column drops on SQLite — not supported)
    if bind.dialect.name != "sqlite":
        op.drop_column("external_access", "environment_id")
        op.drop_column("external_access", "environment_host")
        op.drop_column("external_access", "environment_port")
        op.drop_column("external_access", "proxy_container_id")
        op.drop_column("external_access", "environment_status")
        op.drop_column("external_access", "status_message")


def downgrade() -> None:
    bind = op.get_bind()

    # Re-add old environment columns
    if bind.dialect.name != "sqlite":
        op.add_column("external_access", sa.Column("status_message", sa.Text(), nullable=True))
        op.add_column(
            "external_access",
            sa.Column("environment_status", sa.String(length=50), server_default="running", nullable=False),
        )
        op.add_column("external_access", sa.Column("proxy_container_id", sa.String(length=255), nullable=True))
        op.add_column("external_access", sa.Column("environment_port", sa.Integer(), nullable=True))
        op.add_column("external_access", sa.Column("environment_host", sa.String(length=255), nullable=True))
        op.add_column("external_access", sa.Column("environment_id", sa.String(length=255), nullable=True))

    # Drop new columns
    op.drop_index("ix_external_access_engine_node_id", table_name="external_access")
    if bind.dialect.name != "sqlite":
        op.drop_constraint("fk_external_access_engine_node_id", "external_access", type_="foreignkey")
    op.drop_column("external_access", "pg_proxy_role")
    op.drop_column("external_access", "engine_node_id")

    # Drop query_engine_nodes table
    op.drop_index("ix_query_engine_nodes_org_id", table_name="query_engine_nodes")
    op.drop_table("query_engine_nodes")
