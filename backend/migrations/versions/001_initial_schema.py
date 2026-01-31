"""Initial schema for filter pipeline builder.

Revision ID: 001_initial_schema
Revises:
Create Date: 2024-01-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create run_status enum
    run_status_enum = postgresql.ENUM(
        "pending", "running", "completed", "failed",
        name="run_status",
        create_type=False,
    )
    run_status_enum.create(op.get_bind(), checkfirst=True)

    # Create projects table
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )

    # Create datasets table
    op.create_table(
        "datasets",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("table_name", sa.String(255), nullable=False, unique=True),
        sa.Column("schema_config", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("row_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("file_size", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_datasets_project_id", "datasets", ["project_id"])

    # Create filter_pipelines table
    op.create_table(
        "filter_pipelines",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "dataset_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("raqb_json", postgresql.JSONB, nullable=False),
        sa.Column("cached_sql", sa.Text, nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("nl_prompt", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_filter_pipelines_dataset_id", "filter_pipelines", ["dataset_id"])
    op.create_index("ix_filter_pipelines_is_active", "filter_pipelines", ["is_active"])

    # Create pipeline_runs table
    op.create_table(
        "pipeline_runs",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "pipeline_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("filter_pipelines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM("pending", "running", "completed", "failed", name="run_status", create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("input_row_count", sa.Integer, nullable=True),
        sa.Column("output_row_count", sa.Integer, nullable=True),
        sa.Column("execution_time_ms", sa.Float, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("completed_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_pipeline_runs_pipeline_id", "pipeline_runs", ["pipeline_id"])
    op.create_index("ix_pipeline_runs_status", "pipeline_runs", ["status"])


def downgrade() -> None:
    # Drop tables in reverse order
    op.drop_index("ix_pipeline_runs_status")
    op.drop_index("ix_pipeline_runs_pipeline_id")
    op.drop_table("pipeline_runs")

    op.drop_index("ix_filter_pipelines_is_active")
    op.drop_index("ix_filter_pipelines_dataset_id")
    op.drop_table("filter_pipelines")

    op.drop_index("ix_datasets_project_id")
    op.drop_table("datasets")

    op.drop_table("projects")

    # Drop enum
    run_status_enum = postgresql.ENUM(
        "pending", "running", "completed", "failed",
        name="run_status",
    )
    run_status_enum.drop(op.get_bind(), checkfirst=True)
