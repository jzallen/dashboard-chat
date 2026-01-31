"""MetadataRepository protocol for database operations."""

from typing import Any, Protocol


class MetadataRepositoryProtocol(Protocol):
    """Protocol for metadata database operations.

    This protocol defines the interface for all metadata persistence operations.
    Implementations handle the actual database interaction (e.g., SQLAlchemy).
    """

    # -------------------------------------------------------------------------
    # Project operations
    # -------------------------------------------------------------------------

    async def list_projects(self) -> list[dict[str, Any]]:
        """List all projects ordered by creation date (newest first).

        Returns:
            List of project dictionaries with id, name, description, timestamps.
        """
        ...

    async def get_project(
        self,
        project_id: str,
        include_datasets: bool = True,
    ) -> dict[str, Any] | None:
        """Get a project by ID with optional dataset references.

        Args:
            project_id: Project UUID
            include_datasets: Whether to include sparse dataset info

        Returns:
            Project dict with datasets list, or None if not found.
        """
        ...

    async def create_project(
        self,
        name: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        """Create a new project.

        Args:
            name: Project name
            description: Optional description

        Returns:
            Created project dictionary.
        """
        ...

    async def update_project(
        self,
        project_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a project.

        Args:
            project_id: Project UUID
            update_data: Fields to update (name, description)

        Returns:
            Updated project dict, or None if not found.
        """
        ...

    async def delete_project(self, project_id: str) -> bool:
        """Delete a project and all its datasets.

        Args:
            project_id: Project UUID

        Returns:
            True if deleted, False if not found.
        """
        ...

    # -------------------------------------------------------------------------
    # Dataset operations
    # -------------------------------------------------------------------------

    async def list_datasets(
        self,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """List datasets, optionally filtered by project.

        Args:
            project_id: Optional project UUID to filter by

        Returns:
            List of dataset dictionaries.
        """
        ...

    async def get_dataset(
        self,
        dataset_id: str,
        include_transforms: bool = True,
    ) -> dict[str, Any] | None:
        """Get a dataset by ID with optional transforms.

        Args:
            dataset_id: Dataset UUID
            include_transforms: Whether to include transform list

        Returns:
            Dataset dict with transforms, or None if not found.
        """
        ...

    async def create_dataset(
        self,
        project_id: str,
        dataset_id: str,
        storage_path: str,
        name: str,
        schema_config: dict[str, Any],
        row_count: int,
        file_name: str | None = None,
        file_size: int | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        """Create a new dataset record.

        Args:
            project_id: Parent project UUID
            dataset_id: Dataset UUID (pre-generated)
            storage_path: S3/MinIO path for parquet file
            name: Dataset display name
            schema_config: Field definitions for query builder
            row_count: Number of rows in dataset
            file_name: Original upload filename
            file_size: File size in bytes
            description: Optional description

        Returns:
            Created dataset dictionary.

        Raises:
            ValueError: If project not found.
        """
        ...

    async def update_dataset(
        self,
        dataset_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a dataset's metadata and transforms.

        Transform operations via 'transforms' field:
        - Create: transform without id (requires name, condition_json)
        - Update: transform with id
        - Delete: transform with id and delete=True

        Args:
            dataset_id: Dataset UUID
            update_data: Fields to update

        Returns:
            Updated dataset dict with transforms, or None if not found.
        """
        ...

    async def delete_dataset(self, dataset_id: str) -> str | None:
        """Delete a dataset record.

        Args:
            dataset_id: Dataset UUID

        Returns:
            The storage_path of deleted dataset (for file cleanup), or None if not found.
        """
        ...

    async def project_exists(self, project_id: str) -> bool:
        """Check if a project exists.

        Args:
            project_id: Project UUID

        Returns:
            True if project exists.
        """
        ...

    # -------------------------------------------------------------------------
    # Transform operations
    # -------------------------------------------------------------------------

    async def find_transform_by_sql(
        self,
        dataset_id: str,
        condition_sql: str,
    ) -> dict[str, Any] | None:
        """Find an existing transform with matching SQL.

        Args:
            dataset_id: Parent dataset UUID
            condition_sql: SQL WHERE clause to match

        Returns:
            Transform dict if found, None otherwise.
        """
        ...

    async def create_transform(
        self,
        dataset_id: str,
        name: str,
        condition_json: dict[str, Any],
        condition_sql: str,
        description: str | None = None,
        nl_prompt: str | None = None,
    ) -> dict[str, Any]:
        """Create a new transform.

        Args:
            dataset_id: Parent dataset UUID
            name: Transform name
            condition_json: RAQB JSON tree
            condition_sql: SQL WHERE clause
            description: Optional description
            nl_prompt: Optional original NL prompt

        Returns:
            Created transform dictionary.

        Raises:
            ValueError: If dataset not found.
        """
        ...

    async def update_transform(
        self,
        transform_id: str,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Update a transform.

        If condition_json is updated, version is incremented.

        Args:
            transform_id: Transform UUID
            update_data: Fields to update

        Returns:
            Updated transform dict, or None if not found.
        """
        ...

    async def delete_transform(self, transform_id: str) -> bool:
        """Delete a transform.

        Args:
            transform_id: Transform UUID

        Returns:
            True if deleted, False if not found.
        """
        ...
