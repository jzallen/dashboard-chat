"""UUID IDs with separate storage paths

Revision ID: 004
Revises: 003
Create Date: 2026-01-29

Changes:
- Add storage_path column to datasets table
- Convert dataset IDs from parquet paths to UUIDs
- Update dataset_id column length in transforms table to String(36)
- Add unique constraint and index on storage_path
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    """Apply UUID ID refactoring with storage_path."""

    # 1. Add storage_path column (nullable initially)
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.add_column(sa.Column('storage_path', sa.String(255), nullable=True))

    # 2. Copy existing id to storage_path
    op.execute("UPDATE datasets SET storage_path = id")

    # 3. Extract UUID from parquet path and set as new id
    # Pattern: "project_id/uuid.parquet" -> "uuid"
    # Example: "default-project-001/abc123de-f456-7890-abcd-ef1234567890.parquet" -> "abc123de-f456-7890-abcd-ef1234567890"
    op.execute("""
        UPDATE datasets
        SET id = SUBSTR(id, INSTR(id, '/') + 1, LENGTH(id) - INSTR(id, '/') - 8)
    """)

    # 4. Make storage_path NOT NULL and add constraints
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('storage_path',
                              existing_type=sa.String(255),
                              nullable=False)
        batch_op.create_unique_constraint('uq_datasets_storage_path', ['storage_path'])
        batch_op.create_index('ix_datasets_storage_path', ['storage_path'])

    # 5. Alter datasets.id column to String(36)
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('id',
                              existing_type=sa.String(255),
                              type_=sa.String(36),
                              existing_nullable=False)

    # 6. Update transforms.dataset_id to match new dataset IDs
    # Extract UUID from parquet path
    op.execute("""
        UPDATE transforms
        SET dataset_id = SUBSTR(dataset_id, INSTR(dataset_id, '/') + 1, LENGTH(dataset_id) - INSTR(dataset_id, '/') - 8)
    """)

    # 7. Alter transforms.dataset_id to String(36)
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('dataset_id',
                              existing_type=sa.String(255),
                              type_=sa.String(36),
                              existing_nullable=False)


def downgrade():
    """Revert UUID ID refactoring."""

    # 1. Restore transforms.dataset_id to String(255) using storage_path
    with op.batch_alter_table('transforms') as batch_op:
        batch_op.alter_column('dataset_id',
                              existing_type=sa.String(36),
                              type_=sa.String(255),
                              existing_nullable=False)

    # 2. Restore transforms.dataset_id values from datasets.storage_path
    op.execute("""
        UPDATE transforms
        SET dataset_id = (
            SELECT d.storage_path
            FROM datasets d
            WHERE d.id = transforms.dataset_id
        )
    """)

    # 3. Restore datasets.id to String(255)
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.alter_column('id',
                              existing_type=sa.String(36),
                              type_=sa.String(255),
                              existing_nullable=False)

    # 4. Restore datasets.id values from storage_path
    op.execute("UPDATE datasets SET id = storage_path")

    # 5. Drop storage_path constraints and column
    with op.batch_alter_table('datasets') as batch_op:
        batch_op.drop_index('ix_datasets_storage_path')
        batch_op.drop_constraint('uq_datasets_storage_path', type_='unique')
        batch_op.drop_column('storage_path')
