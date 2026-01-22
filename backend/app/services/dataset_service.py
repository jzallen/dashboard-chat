"""Dataset service for file upload and management."""

import io
import re
from uuid import uuid4

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Dataset
from ..utils.schema_inference import (
    infer_schema_from_dataframe,
    generate_create_table_sql,
    pandas_dtype_to_sql,
)


def sanitize_table_name(name: str) -> str:
    """Create a safe table name from dataset name.

    Args:
        name: Original dataset name

    Returns:
        Sanitized table name safe for PostgreSQL
    """
    # Remove special characters, replace spaces with underscores
    safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name.lower())
    # Ensure it starts with a letter
    if safe_name[0].isdigit():
        safe_name = "t_" + safe_name
    # Add unique suffix
    unique_suffix = uuid4().hex[:8]
    return f"data_{safe_name}_{unique_suffix}"


async def process_csv_upload(
    db: AsyncSession,
    project_id: str,
    name: str,
    file_content: bytes,
    file_name: str | None = None,
    description: str | None = None,
) -> tuple[Dataset, pd.DataFrame]:
    """Process a CSV file upload and create dataset.

    Args:
        db: Database session
        project_id: Parent project ID
        name: Dataset name
        file_content: Raw CSV file bytes
        file_name: Original file name
        description: Optional description

    Returns:
        Tuple of (created Dataset, loaded DataFrame)
    """
    # Read CSV into DataFrame
    df = pd.read_csv(io.BytesIO(file_content))

    # Infer schema from data
    schema_config = infer_schema_from_dataframe(df)

    # Generate safe table name
    table_name = sanitize_table_name(name)

    # Create the dynamic table
    create_sql = generate_create_table_sql(table_name, df)
    await db.execute(text(create_sql))

    # Insert data into the table
    await insert_dataframe_to_table(db, table_name, df)

    # Create dataset record
    dataset = Dataset(
        project_id=project_id,
        name=name,
        description=description,
        table_name=table_name,
        schema_config=schema_config,
        row_count=len(df),
        file_name=file_name,
        file_size=len(file_content),
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    return dataset, df


async def insert_dataframe_to_table(
    db: AsyncSession,
    table_name: str,
    df: pd.DataFrame,
    batch_size: int = 1000,
) -> None:
    """Insert DataFrame rows into a PostgreSQL table.

    Args:
        db: Database session
        table_name: Target table name
        df: DataFrame to insert
        batch_size: Number of rows per batch insert
    """
    if df.empty:
        return

    columns = [f'"{col}"' for col in df.columns]
    columns_sql = ", ".join(columns)

    # Process in batches
    for i in range(0, len(df), batch_size):
        batch = df.iloc[i : i + batch_size]

        # Build VALUES clause
        values_list = []
        for _, row in batch.iterrows():
            values = []
            for val in row:
                if pd.isna(val):
                    values.append("NULL")
                elif isinstance(val, bool):
                    values.append("TRUE" if val else "FALSE")
                elif isinstance(val, (int, float)):
                    values.append(str(val))
                else:
                    # Escape single quotes
                    escaped = str(val).replace("'", "''")
                    values.append(f"'{escaped}'")
            values_list.append(f"({', '.join(values)})")

        values_sql = ",\n".join(values_list)
        insert_sql = f'INSERT INTO "{table_name}" ({columns_sql}) VALUES {values_sql};'
        await db.execute(text(insert_sql))


async def get_dataset_preview(
    db: AsyncSession,
    dataset: Dataset,
    limit: int = 10,
) -> list[dict]:
    """Get preview rows from a dataset's table.

    Args:
        db: Database session
        dataset: Dataset to preview
        limit: Maximum rows to return

    Returns:
        List of row dictionaries
    """
    query = text(f'SELECT * FROM "{dataset.table_name}" LIMIT :limit')
    result = await db.execute(query, {"limit": limit})
    rows = result.fetchall()
    columns = result.keys()
    return [dict(zip(columns, row)) for row in rows]


async def delete_dataset_table(db: AsyncSession, table_name: str) -> None:
    """Drop the dynamic table for a dataset.

    Args:
        db: Database session
        table_name: Table to drop
    """
    await db.execute(text(f'DROP TABLE IF EXISTS "{table_name}" CASCADE'))
    await db.commit()
