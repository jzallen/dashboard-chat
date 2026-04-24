"""Shared dataset-loading helpers for SQL access use cases."""

from typing import TYPE_CHECKING

from app.models.dataset import Dataset

if TYPE_CHECKING:
    from app.repositories.metadata import MetadataRepository


async def load_full_datasets(
    project_id: str,
    metadata_repo: "MetadataRepository",
    *,
    include_transforms: bool = True,
) -> list[Dataset]:
    """Load hydrated `Dataset` objects for a project via the metadata repo.

    Wraps the `list_datasets` + `Dataset.from_record` pair duplicated across
    enable_sql_access and sync_sql_access. Returns ``[]`` for empty projects;
    callers that treat "no datasets" as a domain error (e.g. enable) raise
    their own exception at the use-case level.
    """
    records, _, _ = await metadata_repo.list_datasets(
        project_id, include_transforms=include_transforms
    )
    return [
        Dataset.from_record(r, include_transforms=include_transforms) for r in records
    ]
