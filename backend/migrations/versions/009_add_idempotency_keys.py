"""add idempotency_keys table for endpoint retry deduplication

Revision ID: b9c0d1e2f3a4
Revises: a8b9c0d1e2f3
Create Date: 2026-04-29 05:00:00.000000

Backs Epic C.3: idempotency-key support on mutation endpoints. The table
caches `(user_id, org_id, endpoint, key) -> {status, body, body_hash}` so a
client retry with the same Idempotency-Key returns the prior response
without re-processing. Body hash lets us detect key reuse with mismatched
payload (-> 409). TTL is enforced at read time using `created_at`.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9c0d1e2f3a4"  # pragma: allowlist secret
down_revision: Union[str, None] = "a8b9c0d1e2f3"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("endpoint", sa.String(length=255), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("request_body_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "org_id",
            "endpoint",
            "idempotency_key",
            name="uq_idempotency_keys_scope",
        ),
    )
    op.create_index(
        "ix_idempotency_keys_org_id",
        "idempotency_keys",
        ["org_id"],
    )
    op.create_index(
        "ix_idempotency_keys_created_at",
        "idempotency_keys",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_idempotency_keys_created_at", table_name="idempotency_keys")
    op.drop_index("ix_idempotency_keys_org_id", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
