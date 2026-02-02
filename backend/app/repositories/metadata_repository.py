"""MetadataRepository - SQLAlchemy implementation for metadata persistence.

Session lifecycle (commit/rollback) is managed at the edge (routers/controllers).
This repository uses flush() to persist changes within the transaction.
"""

from typing import Any

from sqlalchemy import select, exists
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import SQLAlchemyError
from functools import wraps

from .project_record import ProjectRecord
from .dataset_record import DatasetRecord
from .transform_record import TransformRecord


class MetadataRepository:
    """SQLAlchemy implementation of MetadataRepositoryProtocol.

    Handles all metadata database operations for projects, datasets, and transforms.

    Note: This repository does NOT commit. Session commit/rollback is managed
    at the router/controller level to ensure transactional consistency.
    """

    def __init__(self, session: 'RestrictedSession') -> None:
        """Initialize with restricted session.

        Args:
            session: RestrictedSession (only exposes execute/add/flush/refresh/delete)
        """
        self._session = session

    # -------------------------------------------------------------------------
    # Project operations
    # -------------------------------------------------------------------------

    async def list_projects(self) -> list[dict[str, Any]]:
        """List all projects ordered by creation date (newest first)."""
        result = await self._session.execute(
            select(ProjectRecord).order_by(ProjectRecord.created_at.desc())
        )
        projects = result.scalars().all()
        return [self._project_to_dict(p) for p in projects]

    async def get_project(
        self,
        project_id: str,
        include_datasets: bool = True,
    ) -> dict[str, Any] | None:
        """Get a project by ID with optional dataset references."""
        query = select(ProjectRecord).where(ProjectRecord.id == project_id)

        if include_datasets:
            query = query.options(selectinload(ProjectRecord.datasets))

        result = await self._session.execute(query)
        project = result.scalar_one_or_none()

        if not project:
            return None

        project_dict = self._project_to_dict(project)

        if include_datasets:
            project_dict["datasets"] = [
                {
                    "id": ds.id,
                    "name": ds.name,
                    "link": f"/api/datasets/{ds.id}",
                    "description": ds.description,
                    "row_count": ds.row_count,
                    "schema_config": ds.schema_config,
                }
                for ds in project.datasets
            ]

        return project_dict

    async def create_project(
        self,
        name: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        """Create a new project."""
        project = ProjectRecord(name=name, description=description)
        self._session.add(project)
        await self._session.flush()
        await self._session.refresh(project)
        return self._project_to_dict(project)

    async def update_project(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a project."""
        result = await self._session.execute(
            select(ProjectRecord).where(ProjectRecord.id == project_id)
        )
        project = result.scalar_one_or_none()

        if not project:
            return None

        for key, value in update_data.items():
            setattr(project, key, value)

        await self._session.flush()
        await self._session.refresh(project)
        return self._project_to_dict(project)

    async def delete_project(self, project_id: str) -> bool:
        """Delete a project and all its datasets."""
        result = await self._session.execute(
            select(ProjectRecord).where(ProjectRecord.id == project_id)
        )
        project = result.scalar_one_or_none()

        if not project:
            return False

        await self._session.delete(project)
        await self._session.flush()
        return True

    async def project_exists(self, project_id: str) -> bool:
        """Check if a project exists."""
        return (await self._session.execute(
            select(exists().where(ProjectRecord.id == project_id))
        )).scalar()

    # -------------------------------------------------------------------------
    # Dataset operations
    # -------------------------------------------------------------------------

    async def list_datasets(
        self,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List datasets, optionally filtered by project."""
        
        query = (
            select(DatasetRecord)
            .options(selectinload(DatasetRecord.transforms.and_(TransformRecord.status != 'deleted')))
            .where(DatasetRecord.project_id == project_id)
            .order_by(DatasetRecord.created_at.desc())
        )

        result = await self._session.execute(query)
        return result.scalars().all()

    async def get_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
    ) -> dict[str, Any] | None:
        """Get a dataset by ID with optional transforms."""
        dataset = await self.get_dataset_record(dataset_id, include_transforms)

        if not dataset:
            return None

        dataset_dict = self._dataset_to_dict(dataset)

        if include_transforms:
            dataset_dict["transforms"] = [
                self._transform_to_dict(t) for t in dataset.transforms
            ]

        return dataset_dict

    async def get_dataset_record(
        self,
        dataset_id: str,
        include_transforms: bool = True,
    ) -> DatasetRecord | None:
        """Get a dataset record by ID with optional transforms.

        Returns the ORM record for domain model conversion.
        """
        query = select(DatasetRecord).where(DatasetRecord.id == dataset_id)

        if include_transforms:
            query = query.options(selectinload(DatasetRecord.transforms.and_(TransformRecord.status != 'deleted')))

        result = await self._session.execute(query)
        return result.scalar_one_or_none()

    async def create_dataset(
        self,
        project_id: str,
        dataset_id: str,
        storage_path: str,
        name: str,
        schema_config: dict[str, Any],
        description: str | None = None,
        partition_fields: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a new dataset record."""
        dataset = DatasetRecord(
            id=dataset_id,
            storage_path=storage_path,
            project_id=project_id,
            name=name,
            description=description,
            schema_config=schema_config,
            partition_fields=partition_fields or [],
        )

        self._session.add(dataset)
        await self._session.flush()
        await self._session.refresh(dataset)
        return self._dataset_to_dict(dataset)

    async def update_dataset(
        self,
        dataset_id: str,
        **kwargs: Any,
    ) -> DatasetRecord:
        """Update a dataset's metadata."""
        result = await self._session.execute(
            select(DatasetRecord)
            .options(selectinload(DatasetRecord.transforms.and_(TransformRecord.status != 'deleted')))
            .where(DatasetRecord.id == dataset_id)
        )
        dataset = result.scalar_one_or_none()

        for key, value in kwargs.items():
            setattr(dataset, key, value)

        await self._session.flush()
        await self._session.refresh(dataset)

        return dataset

    async def delete_dataset(self, dataset_id: str) -> str | None:
        """Delete a dataset record, returning storage_path for file cleanup."""
        result = await self._session.execute(
            select(DatasetRecord).where(DatasetRecord.id == dataset_id)
        )
        dataset = result.scalar_one_or_none()

        if not dataset:
            return None

        storage_path = dataset.storage_path

        await self._session.delete(dataset)
        await self._session.flush()

        return storage_path

    async def project_exists(self, project_id: str) -> bool:
        """Check if a project exists."""
        result = await self._session.execute(
            select(ProjectRecord.id).where(ProjectRecord.id == project_id)
        )
        return result.scalar_one_or_none() is not None

    async def dataset_exists(self, dataset_id: str) -> bool:
        """Check if a dataset exists."""
        return (await self._session.execute(
            select(exists().where(DatasetRecord.id == dataset_id))
        )).scalar()

    # -------------------------------------------------------------------------
    # Transform operations
    # -------------------------------------------------------------------------

    async def find_transform_by_sql(
        self,
        dataset_id: str,
        condition_sql: str,
    ) -> dict[str, Any] | None:
        """Find an existing transform with matching SQL."""
        result = await self._session.execute(
            select(TransformRecord)
            .where(TransformRecord.dataset_id == dataset_id)
            .where(TransformRecord.condition_sql == condition_sql)
            .order_by(TransformRecord.created_at.asc())
            .limit(1)
        )
        transform = result.scalar_one_or_none()

        if not transform:
            return None

        return self._transform_to_dict(transform)

    async def create_transform(
        self,
        dataset_id: str,
        name: str,
        condition_json: dict[str, Any],
        condition_sql: str,
        description: str | None = None,
        nl_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Create a new transform."""
        transform = TransformRecord(
            dataset_id=dataset_id,
            name=name,
            description=description,
            condition_json=condition_json,
            condition_sql=condition_sql,
            nl_prompt=nl_prompt,
        )

        self._session.add(transform)
        await self._session.flush()
        await self._session.refresh(transform)
        return self._transform_to_dict(transform)

    async def update_transform(
        self,
        transform_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a transform."""
        result = await self._session.execute(
            select(TransformRecord).where(TransformRecord.id == transform_id)
        )
        transform = result.scalar_one_or_none()

        if not transform:
            return None

        if update_data.get("name") is not None:
            transform.name = update_data["name"]

        if update_data.get("description") is not None:
            transform.description = update_data["description"]

        if update_data.get("condition_json") is not None:
            transform.condition_json = update_data["condition_json"]
            transform.condition_sql = update_data.get("condition_sql")
            transform.version += 1

        if update_data.get("status") is not None:
            transform.status = update_data["status"]

        await self._session.flush()
        await self._session.refresh(transform)
        return self._transform_to_dict(transform)

    async def update_transforms(self, updates: list[dict[str, Any]]) -> None:
        """Batch update transforms in a single query.

        Args:
            updates: List of dicts, each containing 'id' and fields to update.
        """
        from sqlalchemy import update

        if updates:
            await self._session.execute(update(TransformRecord), updates)
            await self._session.flush()

    async def update_transforms(self, transforms: list[object]) -> None:
        """Batch update transforms in a single query.

        Args:
            transforms: List of Transform domain objects (must support __getitem__).
        """
        from sqlalchemy import update

        if transforms:
            await self._session.execute(update(TransformRecord), transforms)
            await self._session.flush()

    async def delete_transform(self, transform_id: str) -> bool:
        """Delete a transform."""
        result = await self._session.execute(
            select(TransformRecord).where(TransformRecord.id == transform_id)
        )
        transform = result.scalar_one_or_none()

        if not transform:
            return False

        await self._session.delete(transform)
        await self._session.flush()
        return True

    # -------------------------------------------------------------------------
    # Conversion helpers
    # -------------------------------------------------------------------------

    @staticmethod
    def _project_to_dict(project: ProjectRecord) -> dict[str, Any]:
        """Convert ProjectRecord to dictionary."""
        return {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }

    @staticmethod
    def _dataset_to_dict(dataset: DatasetRecord) -> dict[str, Any]:
        """Convert DatasetRecord to dictionary."""
        return {
            "id": dataset.id,
            "storage_path": dataset.storage_path,
            "project_id": dataset.project_id,
            "name": dataset.name,
            "description": dataset.description,
            "schema_config": dataset.schema_config,
            "partition_fields": dataset.partition_fields,
            "created_at": dataset.created_at,
            "updated_at": dataset.updated_at,
        }

    @staticmethod
    def _transform_to_dict(transform: TransformRecord) -> dict[str, Any]:
        """Convert TransformRecord to dictionary."""
        return {
            "id": transform.id,
            "dataset_id": transform.dataset_id,
            "name": transform.name,
            "description": transform.description,
            "condition_json": transform.condition_json,
            "condition_sql": transform.condition_sql,
            "version": transform.version,
            "status": transform.status,
            "nl_prompt": transform.nl_prompt,
            "created_at": transform.created_at,
            "updated_at": transform.updated_at,
        }

