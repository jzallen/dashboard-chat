"""Parquet storage migration: rename fields and update schema

Revision ID: 003
Revises: 002
Create Date: 2026-01-28

Changes:
- Increase datasets.id length to 255 for parquet paths
- Make datasets.table_name nullable (deprecated)
- Rename transforms.raqb_json to condition_json
- Rename transforms.cached_sql to condition_sql
- Update transforms.dataset_id to String(255) to match datasets.id
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade():
    """Apply parquet storage schema changes."""

    # 1. Increase datasets.id field length to accommodate parquet paths
    # Note: This is database-specific. For PostgreSQL, we use ALTER COLUMN
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('id',
                              existing_type=sa.String(36),
                              type_=sa.String(255),
                              existing_nullable=False)

    # 2. Make datasets.table_name nullable (deprecated field)
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('table_name',
                              existing_type=sa.String(255),
                              nullable=True)

    # 3. Rename transform fields to be implementation-agnostic
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('raqb_json', new_column_name='condition_json')
        batch_op.alter_column('cached_sql', new_column_name='condition_sql')

    # 4. Update transforms.dataset_id to String(255) to match datasets.id
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('dataset_id',
                              existing_type=sa.String(36),
                              type_=sa.String(255),
                              existing_nullable=False)

    # 5. Optional: Clear condition_sql to force regeneration with Ibis
    # This ensures all SQL is generated using the new Ibis-based approach
    op.execute("UPDATE transforms SET condition_sql = NULL")


def downgrade():
    """Revert parquet storage schema changes."""

    # Revert field renames
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('condition_json', new_column_name='raqb_json')
        batch_op.alter_column('condition_sql', new_column_name='cached_sql')

    # Revert transforms.dataset_id length
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('dataset_id',
                              existing_type=sa.String(255),
                              type_=sa.String(36),
                              existing_nullable=False)

    # Revert datasets.table_name to not nullable
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('table_name',
                              existing_type=sa.String(255),
                              nullable=False)

    # Revert datasets.id length
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('id',
                              existing_type=sa.String(255),
                              type_=sa.String(36),
                              existing_nullable=False)
