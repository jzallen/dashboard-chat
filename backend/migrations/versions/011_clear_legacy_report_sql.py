"""clear legacy report sql_definition values

Revision ID: d1e2f3a4b5c6
Revises: c0d1e2f3a4b5
Create Date: 2026-05-12 04:40:00.000000

Per ADR-026 §"Decision outcome" item 2 and §"MR roadmap" MR-3: the report
storage column ``sql_definition`` is now ALWAYS derived by
:class:`ReportIbisCompiler` from structured ``columns_metadata``. Pre-prod
codebase, no backfill, no grandfather — any report rows persisted under
the legacy free-form-input contract get their ``sql_definition`` cleared
to an empty string. New reports that carry structured
``columns_metadata`` will repopulate the column via the compiler on the
next mutation; reports that legitimately have no dimension/measure entries
round-trip with an empty string per the 03-03 contract.

Downgrade is intentionally a no-op: the legacy free-form SQL values are
gone for good, there is no reconstruction path, and ADR-026 explicitly
forbids a compatibility shim. A future migration that reintroduces
free-form SQL would itself be an architectural violation.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"  # pragma: allowlist secret
down_revision: Union[str, None] = "c0d1e2f3a4b5"  # pragma: allowlist secret
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Bare UPDATE; portable across SQLite (dev) and PostgreSQL (prod). This
    # is a data-only migration, NOT a schema change, so batch_alter_table
    # is not applicable.
    op.execute(sa.text("UPDATE reports SET sql_definition = ''"))


def downgrade() -> None:
    # Intentional no-op per ADR-026 §"Decision outcome" item 2: pre-prod
    # codebase, no reconstruction path for the cleared free-form SQL.
    pass
