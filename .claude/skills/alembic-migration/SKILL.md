---
name: alembic-migration
description: Use when creating, modifying, or running Alembic database migrations in this project. Covers SQLite/PostgreSQL compatibility rules, column operations, index conventions, downgrade discipline, and org_id indexing requirements.
---

# Alembic Migration Pattern

## Overview

Migrations must work against both SQLite (dev) and PostgreSQL (production). Several common SQL patterns are PostgreSQL-only and will break SQLite — always use the portable alternatives below.

## Generating Migrations

```bash
# Auto-generate from ORM model changes (models must be imported in env.py — already configured)
cd backend && uv run alembic revision --autogenerate -m "add thing table"

# Manual migration (for data migrations, index changes, etc.)
cd backend && uv run alembic revision -m "add index on org_id"

# Apply all pending
cd backend && uv run alembic upgrade head

# Check chain
cd backend && uv run alembic history
```

Auto-generate only detects changes to SQLAlchemy models. Always review the generated file before applying.

## SQLite/PostgreSQL Compatibility Rules

| Need | ❌ PostgreSQL-only | ✅ Portable |
|------|-------------------|------------|
| Auto UUID | `gen_random_uuid()` | `sa.text('(uuidv7())')` as `server_default` |
| JSON column | `JSONB` | `sa.JSON()` |
| JSON array default | `server_default='[]'::jsonb` | `server_default="[]"` with `nullable=False` |
| Alter column type | `op.alter_column()` | Add new column, migrate data, drop old |
| Generated column | `GENERATED ALWAYS AS` | `sa.Computed(expr)` — works in both |

**Never use `op.alter_column()`** — SQLite doesn't support column alteration. Add a new column with the desired type and default instead.

## Column Operations

```python
# Simple nullable column
op.add_column("things", sa.Column("description", sa.Text(), nullable=True))

# Non-nullable with string default
op.add_column("things", sa.Column("status", sa.Text(), nullable=False, server_default="active"))

# Non-nullable with SQL expression default
op.add_column("things", sa.Column("id", sa.Text(), nullable=False,
    server_default=sa.text('(uuidv7())')))

# JSON column with empty array default
op.add_column("things", sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))

# Foreign key with cascade delete
op.add_column("things", sa.Column("project_id", sa.Text(), nullable=False,
    sa.ForeignKey("projects.id", ondelete="CASCADE")))

# Index — naming convention: ix_<table>_<column>
op.create_index("ix_things_org_id", "things", ["org_id"])
op.create_index("ix_things_project_id", "things", ["project_id"])
```

## New Table Template

```python
def upgrade() -> None:
    op.create_table(
        "things",
        sa.Column("id", sa.Text(), nullable=False, server_default=sa.text('(uuidv7())')),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_things_org_id", "things", ["org_id"])  # REQUIRED for every table with org_id

def downgrade() -> None:
    op.drop_index("ix_things_org_id", table_name="things")  # drop indexes before table
    op.drop_table("things")
```

## org_id Index Requirement

**Every table with an `org_id` column must have an index on it.** This is required for query performance on multi-tenant scans.

```python
op.create_index("ix_<table>_org_id", "<table>", ["org_id"])
```

## Downgrade Discipline

Always implement `downgrade()`:
- Drop indexes **before** dropping tables or columns
- Drop columns in **reverse order** of creation
- Mirror every `create_table` with `drop_table`, every `add_column` with `drop_column`

```python
def downgrade() -> None:
    op.drop_index("ix_things_name", table_name="things")
    op.drop_index("ix_things_org_id", table_name="things")
    op.drop_table("things")
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `gen_random_uuid()` as server_default | Use `sa.text('(uuidv7())')` |
| `op.alter_column()` to change type | Add new column, migrate, drop old |
| `JSONB` type | Use `sa.JSON()` |
| JSON array default `'[]'::jsonb` | Use `server_default="[]"` |
| Missing `ix_<table>_org_id` | Add after `create_table` for every `org_id` column |
| Empty `downgrade()` | Always implement the reverse operations |
| Dropping table before its indexes | Drop indexes first |

## Reference Files

- `backend/migrations/env.py` — async setup, model imports, settings integration
- `backend/migrations/versions/006_add_reports_table.py` — complex table creation example
- `backend/migrations/versions/004_add_fk_indexes.py` — index operations
- `backend/migrations/versions/003_add_proxy_and_status_columns.py` — server_default patterns
