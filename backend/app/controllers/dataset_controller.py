"""Controller for dataset operations."""

from typing import Any
from returns.result import Result, Success, Failure
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import Dataset, Project
from ..schemas import DatasetUpdate
from ..services.dataset_service import (
    process_csv_upload,
    get_dataset_preview,
    delete_dataset_table,
)


class DatasetController:
    """Controller for dataset operations."""

    @staticmethod
    async def list_datasets(
        db: AsyncSession,
        project_id: str | None = None,
    ) -> Result[list[Dataset], str]:
        """List all datasets, optionally filtered by project."""
        try:
            query = select(Dataset)
            if project_id:
                query = query.where(Dataset.project_id == project_id)
            query = query.order_by(Dataset.created_at.desc())

            result = await db.execute(query)
            datasets = result.scalars().all()
            return Success(list(datasets))
        except Exception as e:
            return Failure(f"Failed to list datasets: {str(e)}")

    @staticmethod
    async def get_dataset(
        db: AsyncSession,
        dataset_id: str,
        include_transforms: bool = True,
        include_preview: bool = False,
        preview_limit: int = 10,
    ) -> Result[dict[str, Any], str]:
        """Get a single dataset by ID with optional transforms and preview."""
        try:
            query = select(Dataset).where(Dataset.id == dataset_id)

            if include_transforms:
                query = query.options(selectinload(Dataset.transforms))

            result = await db.execute(query)
            dataset = result.scalar_one_or_none()
            if not dataset:
                return Failure("Dataset not found")

            # Convert to dict to add preview if needed
            dataset_dict = {
                "id": dataset.id,
                "project_id": dataset.project_id,
                "name": dataset.name,
                "description": dataset.description,
                "table_name": dataset.table_name,
                "schema_config": dataset.schema_config,
                "row_count": dataset.row_count,
                "file_name": dataset.file_name,
                "file_size": dataset.file_size,
                "created_at": dataset.created_at,
                "updated_at": dataset.updated_at,
                "transforms": dataset.transforms if include_transforms else [],
                "preview_rows": [],
            }

            if include_preview:
                preview_rows = await get_dataset_preview(db, dataset, limit=preview_limit)
                dataset_dict["preview_rows"] = preview_rows

            return Success(dataset_dict)
        except Exception as e:
            return Failure(f"Failed to get dataset: {str(e)}")

    @staticmethod
    async def upload_dataset(
        db: AsyncSession,
        file_content: bytes,
        file_name: str,
        project_id: str,
        name: str,
        description: str | None = None,
    ) -> Result[dict[str, Any], str]:
        """Upload a CSV file and create a dataset."""
        try:
            # Verify project exists
            result = await db.execute(select(Project).where(Project.id == project_id))
            if not result.scalar_one_or_none():
                return Failure("Project not found")

            # Validate file type
            if not file_name.lower().endswith(".csv"):
                return Failure("Only CSV files are supported")

            # Validate file content
            if not file_content:
                return Failure("File is empty")

            # Process the upload
            dataset, df = await process_csv_upload(
                db=db,
                project_id=project_id,
                name=name,
                file_content=file_content,
                file_name=file_name,
                description=description,
            )

            # Get preview rows
            preview_rows = await get_dataset_preview(db, dataset, limit=5)

            return Success({
                "id": dataset.id,
                "project_id": dataset.project_id,
                "name": dataset.name,
                "description": dataset.description,
                "table_name": dataset.table_name,
                "schema_config": dataset.schema_config,
                "row_count": dataset.row_count,
                "file_name": dataset.file_name,
                "file_size": dataset.file_size,
                "created_at": dataset.created_at,
                "updated_at": dataset.updated_at,
                "preview_rows": preview_rows,
            })
        except Exception as e:
            return Failure(f"Failed to process file: {str(e)}")

    @staticmethod
    async def update_dataset(
        db: AsyncSession,
        dataset_id: str,
        update_data: DatasetUpdate,
    ) -> Result[Dataset, str]:
        """Update a dataset's metadata."""
        try:
            result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
            dataset = result.scalar_one_or_none()
            if not dataset:
                return Failure("Dataset not found")

            # Update fields
            update_dict = update_data.model_dump(exclude_unset=True)
            for key, value in update_dict.items():
                setattr(dataset, key, value)

            await db.commit()
            await db.refresh(dataset)
            return Success(dataset)
        except Exception as e:
            return Failure(f"Failed to update dataset: {str(e)}")

    @staticmethod
    async def delete_dataset(
        db: AsyncSession,
        dataset_id: str,
    ) -> Result[dict[str, str], str]:
        """Delete a dataset and its data table."""
        try:
            result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
            dataset = result.scalar_one_or_none()
            if not dataset:
                return Failure("Dataset not found")

            # Drop the dynamic table
            await delete_dataset_table(db, dataset.table_name)

            # Delete the dataset record
            await db.delete(dataset)
            await db.commit()

            return Success({"status": "deleted", "id": dataset_id})
        except Exception as e:
            return Failure(f"Failed to delete dataset: {str(e)}")
